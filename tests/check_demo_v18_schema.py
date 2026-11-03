"""Static consistency checks for the Fixtech Demo v1.8 DDL; not DB integration tests."""

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
DRAWDB = ROOT / "docs" / "fixtech-demo-v1.8-drawdb.sql"
RELEASE = ROOT / "release" / "FixTech-demo-v1.8.database.sql"


class DemoV18SchemaTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.drawdb_sql = DRAWDB.read_text(encoding="utf-8")
        cls.release_sql = RELEASE.read_text(encoding="utf-8")
        cls.tables = list(re.finditer(
            r"(?im)^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?\"?([a-zA-Z_][\w]*)\"?",
            cls.drawdb_sql,
        ))
        cls.table_names = {match.group(1) for match in cls.tables}

    def test_expected_26_domain_tables(self):
        self.assertEqual(30, len(self.tables))
        self.assertEqual(30, len(self.table_names))

    def test_all_foreign_keys_resolve_to_prior_tables(self):
        positions = {match.group(1): match.start() for match in self.tables}
        refs = list(re.finditer(r"(?im)REFERENCES\s+(?:public\.)?\"?([a-zA-Z_][\w]*)\"?", self.drawdb_sql))
        self.assertGreater(len(refs), 0)
        for ref in refs:
            target = ref.group(1)
            with self.subTest(reference=target, offset=ref.start()):
                self.assertIn(target, positions)
                self.assertLess(positions[target], ref.start(), "Referenced table must be created first")

    def test_expanded_scope_entities_exist(self):
        required = {
            "job_attachments", "ai_consents", "ai_analysis_runs", "price_estimates",
            "job_messages", "notifications", "appointments", "payment_simulations",
            "warranties", "warranty_claims", "reviews", "disputes", "admin_audit_logs",
        }
        self.assertTrue(required.issubset(self.table_names), sorted(required - self.table_names))

    def test_release_is_transactional_and_matches_drawdb_schema(self):
        self.assertRegex(self.release_sql, r"(?im)^BEGIN;\s*$")
        self.assertRegex(self.release_sql, r"(?im)^COMMIT;\s*$")
        drawdb_body = self.drawdb_sql[self.drawdb_sql.index("CREATE TABLE"):].strip()
        release_body = self.release_sql[
            self.release_sql.index("CREATE TABLE"):self.release_sql.rindex("COMMIT;")
        ].strip()
        self.assertEqual(drawdb_body, release_body, "DrawDB DDL and install DDL must stay identical")
        release_tables = re.findall(
            r"(?im)^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?\"?([a-zA-Z_][\w]*)\"?",
            self.release_sql,
        )
        self.assertEqual([match.group(1) for match in self.tables], release_tables)

    def test_required_safety_constraints_are_present(self):
        for fragment in (
            "offers_one_selected_per_job",
            "price_estimates_one_accepted_per_job",
            "appointments_one_active_per_job",
            "payment_simulations",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.drawdb_sql)
        for state in ("DRAFT", "READY_TO_PUBLISH", "WAITING_FOR_APPOINTMENT", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "DISPUTED", "CANCELLED"):
            with self.subTest(job_state=state):
                self.assertRegex(self.drawdb_sql, rf"(?s)CREATE TABLE jobs\s*\(.*?'{state}'")

    def test_dictionary_covers_every_physical_column(self):
        full_document = (ROOT / "docs" / "mvp-data-model-v1.md").read_text(encoding="utf-8")
        document = full_document.split("### 9.4 Data Dictionary ฉบับเต็ม 26 ตาราง", 1)[1].split("### 9.5", 1)[0]
        documented = []
        for line in document.splitlines():
            if not line.startswith("| `"):
                continue
            cell = line.split("|")[1].strip()
            match = re.match(r"`([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)`(.*)", cell)
            if not match:
                continue
            table, first, rest = match.groups()
            documented.append((table, first))
            documented.extend((table, name) for name in re.findall(r"/\s*`?([a-z][a-z0-9_]*)", rest))

        physical = set()
        for table in re.finditer(r"(?is)CREATE TABLE\s+(\w+)\s*\((.*?)\n\);", self.drawdb_sql):
            name, body = table.groups()
            for line in body.splitlines():
                column = re.match(r"\s{4}([a-z][a-z0-9_]*)\s+", line)
                if column:
                    physical.add((name, column.group(1)))
        documented_set = set(documented)
        self.assertEqual(len(documented), len(documented_set), "Data Dictionary contains duplicate fields")
        self.assertEqual(physical, documented_set, f"Undocumented or stale fields: {physical ^ documented_set}")

    def test_unavailable_prices_and_appointment_history_are_representable_safely(self):
        for fragment in (
            "source_name varchar(100),",
            "source_reference varchar(500),",
            "source_updated_at timestamptz,",
            "status = 'UNAVAILABLE' AND estimated_min IS NULL AND estimated_max IS NULL",
            "FOREIGN KEY (job_id, supersedes_id) REFERENCES appointments(job_id, id)",
            "UNIQUE (job_id, id)",
            "'SERVICE_QUALITY','PRICE_OR_SCOPE','PAYMENT','WARRANTY','CANCELLATION','OTHER'",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.drawdb_sql)

    def test_current_erd_covers_every_foreign_key_pair_and_nullable_cardinality(self):
        document = (ROOT / "docs" / "mvp-data-model-v1.md").read_text(encoding="utf-8")
        block = document.split("### 9.8 ภาพรวม ER Diagram ครบ 26 ตารางจาก SQL", 1)[1]
        diagram = re.search(r"```mermaid\s+erDiagram(.*?)```", block, re.S).group(1)
        entities = set(re.findall(r"(?m)^\s*(\w+)\s*\{\s*$", diagram))
        self.assertEqual(self.table_names, {name.lower() for name in entities})
        svg = (ROOT / "docs" / "fixtech-demo-v1.8-26-tables.svg").read_text(encoding="utf-8")
        self.assertTrue(all(name.upper() in svg for name in self.table_names))
        relationships = set()
        for line in diagram.splitlines():
            match = re.match(r"\s*(\w+)\s+[|o}{]+--[|o}{]+\s+(\w+)\s*:", line)
            if match:
                relationships.add((match.group(1), match.group(2)))

        ddl_pairs = set()
        for table in re.finditer(r"(?is)CREATE TABLE\s+(\w+)\s*\((.*?)\n\);", self.drawdb_sql):
            name, body = table.groups()
            ddl_pairs.update((parent.upper(), name.upper()) for parent in re.findall(
                r"(?im)^\s{4}\w+\s+[^,\n]*?REFERENCES\s+(\w+)\s*\(", body
            ))
            ddl_pairs.update((parent.upper(), name.upper()) for parent in re.findall(
                r"(?i)FOREIGN KEY\s*\([^)]+\)\s*REFERENCES\s+(\w+)", body
            ))
        missing = {pair for pair in ddl_pairs if pair not in relationships and pair[::-1] not in relationships}
        self.assertFalse(missing, f"ERD omits FK relationships: {sorted(missing)}")
        for cardinality in (
            "USERS o|--o{ JOBS : agrees_price",
            "PROVIDER_PROFILES o|--o{ JOBS : assigned_to",
            "USERS o|--o{ PAYMENT_SIMULATIONS : confirms",
            "USERS ||--o{ WARRANTIES : accepts_terms",
        ):
            with self.subTest(cardinality=cardinality):
                self.assertIn(cardinality, diagram)


if __name__ == "__main__":
    unittest.main(verbosity=2)
