import { startClassificationWorker } from "./classification";
import { startPolicyWorker } from "./policy";

console.log("🚀 Starting Dharma background workers...");

const classificationWorker = startClassificationWorker();
const policyWorker = startPolicyWorker();

process.on("SIGTERM", async () => {
  console.log("SIGTERM received — draining workers...");
  await classificationWorker.close();
  await policyWorker.close();
  process.exit(0);
});
