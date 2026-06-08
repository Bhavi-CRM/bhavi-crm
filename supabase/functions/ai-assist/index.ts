import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const GEMINI_KEY = Deno.env.get("GEMINI_KEY") ?? "";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { context, language, type } = await req.json();

    if (!GEMINI_KEY) {
      return new Response(JSON.stringify({ error: "GEMINI_KEY not configured in Supabase secrets" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    const langInstr = language === "gujarati"
      ? "Write the remark in Gujarati language (Gujarati script)."
      : language === "hindi"
      ? "Write the remark in Hindi language (Devanagari script)."
      : "Write the remark in clear professional English.";

    const prompts: Record<string, string> = {
      update: `You are a field service engineer at Bhavi Electronics & Automation, a CCTV/camera and printer service center in Ahmedabad, India. Write a professional, concise service update remark based on the ticket details provided. ${langInstr} The remark should describe what work was done, current status, and next steps if any. Keep it 2-4 sentences. Be specific and professional. Do not use placeholder text.`,

      feedback: `You are writing on behalf of a customer who received service from Bhavi Electronics & Automation. Write a professional customer satisfaction feedback comment based on the service details provided. ${langInstr} The feedback should reflect the customer experience — mention service quality, engineer behavior, and resolution. Keep it 2-3 sentences. Make it sound genuine and natural.`,

      worklog: `You are a field service engineer at Bhavi Electronics & Automation, a CCTV/camera and printer service center in Ahmedabad, India. Write a professional work log entry describing the task completed. ${langInstr} Include what was done, any issues encountered, and outcome. Keep it 1-3 sentences. Be specific.`,

      dailyreport: `You are a service engineer at Bhavi Electronics & Automation writing your daily activity report. Summarize the day's work professionally based on the context provided. ${langInstr} Mention tickets handled, tasks completed, and any pending items. Keep it 3-5 sentences.`,

      visit: `You are a field service engineer at Bhavi Electronics & Automation writing a site visit report. Describe the work done at the customer site based on the context provided. ${langInstr} Include observations, work performed, and recommendations. Keep it 2-4 sentences.`,

      inquiry: `You are a sales/service coordinator at Bhavi Electronics & Automation. Write a professional description for this service/product inquiry based on the context provided. ${langInstr} Be clear about requirements and any special notes. Keep it 2-3 sentences.`,
    };

    const systemPrompt = prompts[type] ?? prompts.update;
    const userMessage = context
      ? `Here are the details:\n${context}\n\nPlease write the remark now.`
      : "No specific context provided. Write a general professional remark suitable for a service ticket.";

    const fullPrompt = `${systemPrompt}\n\n${userMessage}`;

    const resp = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { maxOutputTokens: 300, temperature: 0.7 },
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return new Response(JSON.stringify({ error: `Gemini API error: ${err}` }), {
        status: 502, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    return new Response(JSON.stringify({ text: text.trim() }), {
      headers: { ...CORS, "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
});
