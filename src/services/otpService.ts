import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER; // E.164, e.g., +12025550123

let client: ReturnType<typeof twilio> | null = null;

function getClient() {
  if (!client) {
    if (!accountSid || !authToken) {
      throw new Error("Twilio credentials are not configured");
    }
    client = twilio(accountSid, authToken);
  }
  return client;
}

export async function sendOTP(phoneNumber: string, otp: string): Promise<string> {
  try {
    if (!fromNumber) throw new Error("TWILIO_PHONE_NUMBER is not configured");
    const c = getClient();
    const message = await c.messages.create({
      body: `Your Klord login OTP is ${otp}. It will expire in 5 minutes.`,
      from: fromNumber,
      to: phoneNumber,
    });
    // eslint-disable-next-line no-console
    console.log("[twilio] OTP sent:", message.sid);
    return message.sid;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[twilio] Error sending OTP:", err);
    throw err;
  }
}
