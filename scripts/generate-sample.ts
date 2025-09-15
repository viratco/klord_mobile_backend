import { generateCertificatePDF } from "../src/services/certificateService.ts";

async function main() {
  const data = {
    leadId: "SAMPLE-LEAD",
    customerName: "Sample Customer",
    projectType: "Solar Rooftop",
    sizedKW: 6.5,
    installDate: new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" }),
    location: "Patna, Bihar, India",
    certificateId: `SAMPLE-${Date.now().toString().slice(-6)}`,
  };

  const { publicUrl, filePath } = await generateCertificatePDF(data);
  console.log(JSON.stringify({ ok: true, publicUrl, filePath }, null, 2));
}

main().catch((err) => { console.error(err); process.exit(1); });
