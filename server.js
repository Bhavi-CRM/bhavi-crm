const express = require('express');
const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ─── Credentials ───────────────────────────────────────────────────────────────
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM        = 'whatsapp:+14155238886';
const SUPABASE_URL       = process.env.SUPABASE_URL;
const SUPABASE_KEY       = process.env.SUPABASE_KEY;
const ENGINEER_PHONE     = process.env.ENGINEER_PHONE || '+91XXXXXXXXXX'; // Set karjo

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// ─── In-memory session store ────────────────────────────────────────────────────
// (Production ma Redis use karo, demo mate in-memory okay chhe)
const sessions = {};

function getSession(phone) {
  if (!sessions[phone]) {
    sessions[phone] = { step: 'MAIN_MENU', data: {} };
  }
  return sessions[phone];
}

function resetSession(phone) {
  sessions[phone] = { step: 'MAIN_MENU', data: {} };
}

// ─── Ticket ID Generator ────────────────────────────────────────────────────────
async function generateTicketId() {
  const year = new Date().getFullYear();
  // Supabase thi last ticket no lavo
  const { data, error } = await supabase
    .from('service_tickets')
    .select('ticket_id')
    .like('ticket_id', `BEA-${year}-%`)
    .order('ticket_id', { ascending: false })
    .limit(1);

  let nextNum = 1;
  if (data && data.length > 0) {
    const last = data[0].ticket_id; // e.g. BEA-2026-007
    const parts = last.split('-');
    nextNum = parseInt(parts[2]) + 1;
  }
  return `BEA-${year}-${String(nextNum).padStart(3, '0')}`;
}

// ─── Supabase: Ticket create ────────────────────────────────────────────────────
async function createTicket(ticketData) {
  const ticketId = await generateTicketId();
  const { data, error } = await supabase
    .from('service_tickets')
    .insert([{
      ticket_id:    ticketId,
      customer_phone: ticketData.phone,
      service_type: ticketData.serviceType,
      model_number: ticketData.model,
      problem:      ticketData.problem,
      address:      ticketData.address || null,
      status:       'Pending',
      created_at:   new Date().toISOString()
    }])
    .select();

  if (error) throw error;
  return ticketId;
}

// ─── Supabase: Status fetch ─────────────────────────────────────────────────────
async function fetchTicketStatus(query) {
  let supabaseQuery = supabase
    .from('service_tickets')
    .select('ticket_id, status, engineer_name, model_number, problem, created_at');

  // Ticket ID chhe ke phone number?
  if (query.startsWith('BEA-') || query.startsWith('bea-')) {
    supabaseQuery = supabaseQuery
      .ilike('ticket_id', query.trim());
  } else {
    // Phone number thi search
    const phone = query.replace(/\D/g, ''); // digits only
    supabaseQuery = supabaseQuery
      .ilike('customer_phone', `%${phone}%`)
      .order('created_at', { ascending: false })
      .limit(3);
  }

  const { data, error } = await supabaseQuery;
  if (error) throw error;
  return data;
}

// ─── Message Handler ────────────────────────────────────────────────────────────
async function handleMessage(fromPhone, incomingMsg) {
  const msg    = incomingMsg.trim();
  const msgLow = msg.toLowerCase();
  const session = getSession(fromPhone);

  // Anytime "menu" ya "hi" aave to reset
  if (['hi', 'hello', 'menu', 'start', 'hii', 'hey'].includes(msgLow)) {
    resetSession(fromPhone);
    return mainMenu();
  }

  // ── MAIN MENU ──
  if (session.step === 'MAIN_MENU') {
    if (msg === '1') {
      session.step = 'SERVICE_TYPE';
      return `*Service Request* 🔧\n\nKeva prakar ni service joiye chhe?\n\n1️⃣ Carry In (Shop par lavo)\n2️⃣ On Site (Ghar par aaviye)\n\n_(Cancel mate "menu" likho)_`;
    } else if (msg === '2') {
      session.step = 'STATUS_CHECK';
      return `*Ticket Status* 📋\n\nTamaro Ticket ID (BEA-2026-XXX) ya\nRegistered Mobile Number aapvo:`;
    } else if (msg === '3') {
      return `*Engineer Support* 👨‍🔧\n\nAmara engineer saathe seedha vaat karo:\n📞 ${ENGINEER_PHONE}\n\n_(WhatsApp par message pan kari shako cho)_`;
    } else {
      return mainMenu();
    }
  }

  // ── SERVICE FLOW ──
  if (session.step === 'SERVICE_TYPE') {
    if (msg === '1') {
      session.data.serviceType = 'Carry In';
    } else if (msg === '2') {
      session.data.serviceType = 'On Site';
    } else {
      return `1 ya 2 select karo:\n1️⃣ Carry In\n2️⃣ On Site`;
    }
    session.step = 'MODEL_NUMBER';
    return `Tamara device no *Model Number* aapvo:\n_(Example: Samsung Galaxy A54, LG 1.5T AC, Sony TV 43")_`;
  }

  if (session.step === 'MODEL_NUMBER') {
    session.data.model = msg;
    session.step = 'PROBLEM';
    return `*Problem describe karo*:\n_(Example: Screen touch nathi kaam karta, AC cooling nathi karta, TV start nathi thaato)_`;
  }

  if (session.step === 'PROBLEM') {
    session.data.problem = msg;
    if (session.data.serviceType === 'On Site') {
      session.step = 'ADDRESS';
      return `Tamaro *Address* aapvo (On Site service mate):`;
    } else {
      session.step = 'CONFIRM';
      return confirmMessage(session.data, fromPhone);
    }
  }

  if (session.step === 'ADDRESS') {
    session.data.address = msg;
    session.step = 'CONFIRM';
    return confirmMessage(session.data, fromPhone);
  }

  if (session.step === 'CONFIRM') {
    if (msg === '1' || msgLow === 'yes' || msgLow === 'ha') {
      // Ticket create karo
      try {
        session.data.phone = fromPhone.replace('whatsapp:+', '');
        const ticketId = await createTicket(session.data);
        resetSession(fromPhone);
        return `✅ *Ticket Create Thayu!*\n\n🎫 Ticket ID: *${ticketId}*\n📱 Aa ID save karo — status check mate kaam aavse\n\n⏰ Amaro team 2-4 kalaak ma contact karse\n\nAabhaar! Bhavi Electronics 🙏\n\n_(Biji madad mate "menu" likho)_`;
      } catch (err) {
        console.error('Ticket create error:', err);
        return `⚠️ System error aavyo. Thodi var bad try karo ya direct call karo:\n📞 ${ENGINEER_PHONE}`;
      }
    } else if (msg === '2' || msgLow === 'no' || msgLow === 'na') {
      resetSession(fromPhone);
      return `Okay! Request cancel karyu.\n\n` + mainMenu();
    } else {
      return `1 ya 2 aapvo:\n1️⃣ Confirm\n2️⃣ Cancel`;
    }
  }

  // ── STATUS CHECK FLOW ──
  if (session.step === 'STATUS_CHECK') {
    try {
      const tickets = await fetchTicketStatus(msg);
      resetSession(fromPhone);
      if (!tickets || tickets.length === 0) {
        return `❌ Koi ticket maldyu nahi.\n\nBari check karo:\n• Ticket ID: BEA-2026-XXX format ma hovo joiye\n• Mobile: registered number aapvo\n\n_(Navi help mate "menu" likho)_`;
      }

      let response = `📋 *Ticket Status*\n${'─'.repeat(25)}\n\n`;
      tickets.forEach((t, i) => {
        const statusEmoji = {
          'Pending':     '⏳',
          'In Progress': '🔧',
          'Completed':   '✅',
          'Cancelled':   '❌'
        }[t.status] || '📌';

        response += `*${i + 1}. ${t.ticket_id}*\n`;
        response += `📱 Model: ${t.model_number}\n`;
        response += `🔹 Problem: ${t.problem}\n`;
        response += `${statusEmoji} Status: *${t.status}*\n`;
        if (t.engineer_name) {
          response += `👨‍🔧 Engineer: ${t.engineer_name}\n`;
        }
        response += `📅 Date: ${new Date(t.created_at).toLocaleDateString('en-IN')}\n\n`;
      });

      response += `_(Navi help mate "menu" likho)_`;
      return response;
    } catch (err) {
      console.error('Status fetch error:', err);
      resetSession(fromPhone);
      return `⚠️ Status fetch karta error aavyo. Thodi var bad try karo.\n\n_(Menu mate "menu" likho)_`;
    }
  }

  return mainMenu();
}

// ─── Helper Functions ───────────────────────────────────────────────────────────
function mainMenu() {
  return `🙏 *Namaste! Bhavi Electronics ma aavkaar chhe!*\n\nShu joiye chhe?\n\n1️⃣ Service Request\n2️⃣ Ticket Status Check\n3️⃣ Engineer saathe vaat\n\n_Number select karo (1, 2, ya 3)_`;
}

function confirmMessage(data, phone) {
  let msg = `📝 *Confirm Karo*\n${'─'.repeat(20)}\n\n`;
  msg += `🔧 Service: ${data.serviceType}\n`;
  msg += `📱 Model: ${data.model}\n`;
  msg += `🔹 Problem: ${data.problem}\n`;
  if (data.address) msg += `📍 Address: ${data.address}\n`;
  msg += `\nSahi chhe?\n1️⃣ Confirm\n2️⃣ Cancel`;
  return msg;
}

// ─── Twilio Webhook ─────────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const from = req.body.From;   // e.g. "whatsapp:+919876543210"
  const body = req.body.Body || '';

  console.log(`[${new Date().toISOString()}] From: ${from} | Msg: ${body}`);

  try {
    const replyText = await handleMessage(from, body);

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(replyText);
    res.type('text/xml').send(twiml.toString());
  } catch (err) {
    console.error('Webhook error:', err);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message('⚠️ Technical issue. Thodi var bad try karo.');
    res.type('text/xml').send(twiml.toString());
  }
});

// ─── Health Check ───────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ 
    status: 'Bhavi Electronics Chatbot Running! 🚀',
    time: new Date().toISOString()
  });
});

// ─── Start Server ───────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Bhavi Electronics Chatbot running on port ${PORT}`);
});
