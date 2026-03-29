const target = process.env.UNSTABLE_TARGET || "http://localhost:5001";
const rounds = Number(process.env.STRESS_ROUNDS || 6);
const concurrent = Number(process.env.STRESS_CONCURRENT || 80);

async function fireOne(index) {
  const response = await fetch(`${target}/api/join-queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: `stress-user-${index}`,
      path: "/"
    })
  });

  return response.status;
}

async function run() {
  console.log(`Stress target: ${target}`);
  console.log(`Rounds: ${rounds}, Concurrent requests/round: ${concurrent}`);

  for (let round = 1; round <= rounds; round += 1) {
    const promises = [];
    for (let i = 0; i < concurrent; i += 1) {
      promises.push(fireOne(i + round * 10_000));
    }

    try {
      const statuses = await Promise.all(promises);
      const ok = statuses.filter((code) => code < 400).length;
      const fail = statuses.length - ok;
      console.log(`Round ${round}: ok=${ok}, fail=${fail}`);
    } catch (error) {
      console.error(`Round ${round}: request batch failed`, error.message);
      break;
    }
  }

  console.log("Stress run completed.");
}

run().catch((error) => {
  console.error("Stress run crashed:", error);
  process.exit(1);
});
