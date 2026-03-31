import 'dotenv/config';
import { assistWithTask, generateBrief } from "./services/aiService.js";

async function run() {
  try {
    const taskResult = await assistWithTask({ mode: "singleTaskGenerate", input: "test concept\nProduct: Face Cream\nAngle: emotional", boardType: "video" });
    console.log("Task result:", taskResult);

    const task = taskResult?.tasks?.[0] ?? taskResult;
    const formValues = Object.entries(task)
      .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => ({ label: k, value: Array.isArray(v) ? v.join(", ") : String(v) }));

    const brief = await generateBrief({ formValues, boardType: "video" });
    console.log("Brief length:", brief.length);
  } catch (err) {
    console.error("Error occurred:");
    console.error(err);
  }
}
run();
