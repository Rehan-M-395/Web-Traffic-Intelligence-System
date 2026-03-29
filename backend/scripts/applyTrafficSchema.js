require("dotenv").config();

const fs = require("fs");
const path = require("path");
const sql = require("../neon_connection");

function splitStatements(schemaText) {
  return schemaText
    .split(/;\s*\r?\n/g)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function applyTrafficSchema() {
  const schemaPath = path.join(__dirname, "..", "db", "traffic_intelligence_schema.sql");
  const schemaText = fs.readFileSync(schemaPath, "utf8");
  const statements = splitStatements(schemaText);

  for (const statement of statements) {
    await sql.query(statement);
  }

  console.log(`Applied ${statements.length} traffic intelligence schema statements.`);
}

applyTrafficSchema().catch((error) => {
  console.error("Failed to apply traffic intelligence schema.");
  console.error(error);
  process.exit(1);
});
