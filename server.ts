import fs from "fs/promises";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { Resend } from "resend";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: "50mb" }));

// Configuracao do Resend (substitui Nodemailer)
const resend = new Resend(process.env.RESEND_API_KEY);

// Configuracao de email
const RESEND_FROM = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || RESEND_FROM;

// Data paths
const dataDir = path.join(process.cwd(), "data");
const materialsPath = path.join(dataDir, "materials.json");
const campaignsPath = path.join(dataDir, "campaigns.json");
const quotesPath = path.join(dataDir, "quotes.json");
const processedMsgsPath = path.join(dataDir, "processed_messages.json");
const notificationsPath = path.join(dataDir, "notifications.json");

// Types
type ServiceType = "none" | "formacao" | "ferias" | "agendamento_consular" | "passagem" | "reserva_hotel" | "reserva_passagem";
type MaterialCategory = "docs_ferias" | "docs_contrato" | "docs_estudante" | "dados_bancarios" | "precario";
type QuoteStatus = "pending" | "quoted" | "accepted" | "rejected";
type NotificationType = "documentos_recebidos" | "lead_novo" | "cotacao_solicitada" | "pagamento_recebido";

interface Material {
  id: string;
  title: string;
  category: MaterialCategory;
  fileUrl: string;
  fileType: string;
  fileName: string;
}

interface Campaign {
  id: string;
  title: string;
  description?: string;
  keywords: string[];
  context: string;
  discount?: string;
  price?: number;
  active: boolean;
  createdAt: string;
}

interface Quote {
  id: string;
  clientId: string;
  clientName: string;
  destination: string;
  details: string;
  price?: string;
  observation?: string;
  status: QuoteStatus;
  createdAt: string;
  updatedAt: string;
}

interface Notification {
  id: string;
  type: NotificationType;
  clientId: string;
  clientName?: string;
  message: string;
  data?: Record<string, any>;
  read: boolean;
  createdAt: string;
}

interface ClientSession {
  senderId: string;
  service: ServiceType;
  step: string;
  data: Record<string, string>;
  updatedAt: string;
  history: Array<{role: "user" | "model", text: string}>;
  quoteId?: string;
  lastIntent?: string;
}

// State
const sessions: Record<string, ClientSession> = {};
let processedMessageIds: Set<string> = new Set();

// Carrega mensagens processadas do arquivo
async function loadProcessedMessages() {
  try {
    const data = await fs.readFile(processedMsgsPath, "utf-8");
    const ids = JSON.parse(data);
    processedMessageIds = new Set(ids);
    console.log(`Carregados ${processedMessageIds.size} IDs de mensagens processadas`);
  } catch {
    processedMessageIds = new Set();
  }
}

// Salva mensagens processadas
async function saveProcessedMessages() {
  try {
    await fs.writeFile(processedMsgsPath, JSON.stringify([...processedMessageIds]), "utf-8");
  } catch (e) {
    console.error("Erro salvando processed messages:", e);
  }
}

// Helpers
async function ensureDataFiles() {
  await fs.mkdir(dataDir, { recursive: true });
  for (const file of [materialsPath, campaignsPath, quotesPath, processedMsgsPath, notificationsPath]) {
    try {
      await fs.access(file);
    } catch {
      await fs.writeFile(file, JSON.stringify([], null, 2), "utf-8");
    }
  }
  await loadProcessedMessages();
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile<T>(filePath: string, data: T) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

async function getClientSession(senderId: string): Promise<ClientSession> {
  if (!sessions[senderId]) {
    sessions[senderId] = {
      senderId,
      service: "none",
      step: "",
      data: {},
      updatedAt: new Date().toISOString(),
      history: [],
    };
  }
  return sessions[senderId];
}

async function saveClientSession(session: ClientSession) {
  sessions[session.senderId] = {
    ...session,
    updatedAt: new Date().toISOString(),
  };
}

function resetSession(session: ClientSession): ClientSession {
  return {
    ...session,
    service: "none",
    step: "",
    data: {},
    updatedAt: new Date().toISOString(),
    history: [],
    quoteId: undefined,
    lastIntent: undefined,
  };
}

// Email notifications via Resend (funciona no Render)
async function notifyLead(subject: string, body: string) {
  try {
    if (!process.env.RESEND_API_KEY) {
      console.log("Resend nao configurado, pulando email:", subject);
      return;
    }

    const { data, error } = await resend.emails.send({
      from: RESEND_FROM,
      to: [NOTIFY_EMAIL],
      subject: subject,
      text: body,
    });

    if (error) {
      console.error("Erro email Resend:", error);
      return;
    }

    console.log("Email enviado:", data?.id, subject);
  } catch (error) {
    console.error("Erro email:", error);
  }
}

// NOTIFICACAO PARA APP CENTRAL
async function notifyAppCentral(type: NotificationType, clientId: string, message: string, data?: Record<string, any>) {
  try {
    const notifications = await readJsonFile<Notification[]>(notificationsPath, []);
    const newNotification: Notification = {
      id: `notif_${Date.now()}`,
      type,
      clientId,
      clientName: data?.clientName || "Cliente",
      message,
      data,
      read: false,
      createdAt: new Date().toISOString(),
    };
    notifications.push(newNotification);
    await writeJsonFile(notificationsPath, notifications);
    console.log(`Notificacao app central criada: ${type} - ${clientId}`);

    await notifyLead(
      `App Central: ${type.replace(/_/g, ' ').toUpperCase()}`,
      `Cliente: ${clientId}\\nMensagem: ${message}\\nDados: ${JSON.stringify(data, null, 2)}`
    );
  } catch (error) {
    console.error("Erro criando notificacao:", error);
  }
}

// Meta Messenger
async function sendMessengerMessage(recipientId: string, text: string, material?: Material) {
  const token = process.env.PAGE_ACCESS_TOKEN;
  if (!token) throw new Error("PAGE_ACCESS_TOKEN nao configurado");

  const url = `https://graph.facebook.com/v23.0/me/messages?access_token=${token}`;

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
    }),
  });

  if (material) {
    if (material.fileType.startsWith("image/")) {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: {
            attachment: {
              type: "image",
              payload: { url: material.fileUrl, is_reusable: true }
            }
          },
        }),
      });
    } else {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text: `${material.title}: ${material.fileUrl}` },
        }),
      });
    }
  }
}

// Funcao para enviar cotacao ao cliente via Messenger
async function sendQuoteToClient(quoteId: string, price: string, observation?: string) {
  try {
    // Busca a cotacao
    const quotes = await readJsonFile<Quote[]>(quotesPath, []);
    const quote = quotes.find(q => q.id === quoteId);
    
    if (!quote) {
      console.error("Cotacao nao encontrada:", quoteId);
      return { success: false, error: "Cotacao nao encontrada" };
    }

    // Atualiza a cotacao
    quote.price = price;
    if (observation) quote.observation = observation;
    quote.status = "quoted";
    quote.updatedAt = new Date().toISOString();
    
    await writeJsonFile(quotesPath, quotes);

    // Monta a mensagem para o cliente
    let message = `✅ **Cotacao Pronta!**\\n\\n`;
    message += `**Destino:** ${quote.destination}\\n`;
    message += `**Detalhes:** ${quote.details}\\n`;
    message += `**Preco:** ${price} CVE\\n`;
    
    if (observation) {
      message += `\\n**Observacoes:** ${observation}\\n`;
    }
    
    message += `\\n**Como garantir a sua passagem:**\\n\\n`;
    message += `**Opcao 1 – Presencial (recomendado):**\\n`;
    message += `• Dirige-se a nossa agencia em Achada Sao Filipe, Praia\\n`;
    message += `• Faz o pagamento no local\\n`;
    message += `• Entrega a foto do passaporte + NIF\\n`;
    message += `• Emitimos imediatamente a passagem\\n\\n`;
    message += `**Opcao 2 – Online:**\\n`;
    message += `1️⃣ Envio os dados para pagamento\\n`;
    message += `2️⃣ Apos o pagamento, envia o comprovante\\n`;
    message += `3️⃣ Em seguida envia a foto do passaporte + NIF\\n`;
    message += `4️⃣ Emitimos imediatamente e enviamos por WhatsApp ou email\\n\\n`;
    message += `Diga-me, por favor, qual opcao prefere para avancarmos 😊`;
    
    // Envia a mensagem
    await sendMessengerMessage(quote.clientId, message);
    
    console.log(`Cotacao enviada para ${quote.clientId}: ${price} CVE`);
    
    // Atualiza a sessao do cliente para refletir que recebeu cotacao
    const session = await getClientSession(quote.clientId);
    if (session.quoteId === quoteId) {
      session.step = "passagem_cotacao_enviada";
      await saveClientSession(session);
    }
    
    return { success: true, message: "Cotacao enviada ao cliente" };
  } catch (error) {
    console.error("Erro enviando cotacao:", error);
    return { success: false, error: String(error) };
  }
}

// Respostas para perguntas comuns baseadas no contexto
function getCommonResponse(text: string, session: ClientSession): string | null {
  const lower = text.toLowerCase().trim();
  
  // Agradecimentos e encerramento
  if (lower.includes("obrigado") || lower.includes("obrigada") || lower.includes("ok") || 
      lower.includes("entendido") || lower.includes("certo") || lower.includes("perfeito") ||
      lower.includes("valeu") || lower.includes("thanks") || lower.includes("grato")) {
    return `De nada! 😊 Estou aqui sempre que precisar.

Se surgir alguma duvida sobre a **${session.data.curso || 'formacao'}** ou quiser falar de outro servico, e so escrever **reiniciar** ou enviar mensagem.

Bom dia e ate breve!`;
  }
  
  // Perguntas sobre outros serviços
  if (lower.includes("quais servicos") || lower.includes("que servicos") || lower.includes("o que fazem") || 
      lower.includes("fazem o que") || lower.includes("servicos disponiveis") || lower.includes("outros servicos")) {
    return `**Servicos Aventour:**

✈️ **Passagens Aereas** – Nacional e internacional
🏨 **Reserva de Hotel** – 60 CVE/dia
🎓 **Formacao em Portugal** – Cursos profissionalizantes
📅 **Agendamento Consular** – Visto de estudante/trabalho
🏖️ **Agendamento de Ferias** – Pacote completo passagem + hotel
🎫 **Reserva de Passagem** – Bloqueio de vaga (1.000 CVE)

Qual servico lhe interessa? Ou escreva **reiniciar** para comecar.`;
  }
  
  // Perguntas sobre agendamento (genérico) - quando NAO esta no fluxo de agendamento
  if ((lower.includes("agendamento") || lower.includes("fazem agendamento") || lower.includes("tem agendamento")) && 
      session.service !== "agendamento_consular") {
    return `Sim, fazemos **Agendamento Consular**! 📅

**Para quem:**
• Estudantes (visto de estudos)
• Contrato de trabalho (visto de trabalho)

**Valor:** 16.940 CVE (12.500 servico + 4.440 taxa consular)
**Local:** Presencial na agencia em Achada Sao Filipe

Quer iniciar o agendamento? Escreva **"quero agendamento"** ou **reiniciar**.`;
  }
  
  // Perguntas sobre cursos específicos
  if (lower.includes("marketing") || lower.includes("digital") || lower.includes("auxiliar") || 
      lower.includes("turismo") || lower.includes("contabilidade") || lower.includes("administrativo")) {
    return `Excelente escolha! O curso de **${text}** tem alta empregabilidade em Portugal.

**Detalhes:**
• Duracao: 1 ano
• Local: Lisboa
• Estagio incluido
• Empregabilidade: +85%

Quer prosseguir com a inscricao? Precisamos da sua idade primeiro.`;
  }
  
  // Perguntas sobre prazos/tempo
  if (lower.includes("quando") || lower.includes("tempo") || lower.includes("demora") || 
      lower.includes("prazo") || lower.includes("duracao") || lower.includes("quanto tempo")) {
    if (session.service === "formacao") {
      return `**Duracao da Formacao: 1 ano**

• 6-8 meses: Aulas teoricas em Lisboa
• 4-6 meses: Estagio profissional
• Certificado reconhecido em Portugal

Todo o processo de inscricao leva cerca de 2-3 semanas apos entrega dos documentos.`;
    }
    
    if (session.service === "passagem") {
      return `**Prazos:**

• Cotacao: 24-48h
• Emissao apos pagamento: Imediata (presencial) ou 2-4h (online)
• Recomendamos garantir com antecedencia de pelo menos 1 semana`;
    }
    
    return `Os prazos dependem do servico:

• **Formacao:** Inscricao 2-3 semanas | Curso 1 ano
• **Passagens:** Emissao imediata apos pagamento
• **Agendamento Consular:** Depende da disponibilidade do consulado

Qual servico quer saber mais?`;
  }
  
  // Perguntas sobre localizacao/endereco
  if (lower.includes("onde fica") || lower.includes("onde ficam") || lower.includes("endereco") || 
      lower.includes("morada") || lower.includes("localizacao") || lower.includes("localizacao") ||
      lower.includes("achada") || lower.includes("sao filipe") || lower.includes("praia")) {
    return "Estamos localizados em **Achada Sao Filipe, Praia**, ao lado de Calu e Angela. Pode visitar-nos de segunda a sexta, das 8h as 17h.";
  }
  
  // Perguntas sobre pagamento
  if (lower.includes("pagamento") || lower.includes("pagar") || lower.includes("como pago") || 
      lower.includes("transferencia") || lower.includes("deposito") || lower.includes("dinheiro")) {
    
    // Se esta no fluxo de passagem
    if (session.service === "passagem") {
      return `**Como garantir a sua passagem:**

**Opcao 1 – Presencial (recomendado):**
• Dirige-se a nossa agencia em Achada Sao Filipe, Praia
• Faz o pagamento no local
• Entrega a foto do passaporte + NIF
• Emitimos imediatamente a passagem

**Opcao 2 – Online:**
1️⃣ Envio os dados para pagamento
2️⃣ Apos o pagamento, envia o comprovante
3️⃣ Em seguida envia a foto do passaporte + NIF
4️⃣ Emitimos imediatamente e enviamos por WhatsApp ou email

Qual opcao prefere?`;
    }
    
    // Se esta no fluxo de formacao
    if (session.service === "formacao") {
      return `**Pagamento da Formacao (45.000 CVE):**

• **6.000 CVE** – inscricao (pode ser transferencia)
• **39.000 CVE** – declaracao de matricula (apenas em **cheque ou dinheiro**, presencialmente)

Em Portugal, pagas apenas **300 euros** para concluir o valor total do curso. Nao ha mensalidades.

Pode fazer o pagamento da inscricao na agencia ou por transferencia. Os 39.000 CVE devem ser pagos presencialmente em cheque ou dinheiro.`;
    }
    
    // Se esta no fluxo de agendamento consular
    if (session.service === "agendamento_consular") {
      return `**Pagamento do Agendamento Consular:**

• **12.500 CVE** – servico Aventour
• **4.440 CVE** – taxa consular
• **Total: 16.940 CVE**

Deve comparecer a agencia em **Achada Sao Filipe, Praia** com:
• Passaporte original
• Comprovativo de pagamento dos 16.940 CVE

Pagamento pode ser feito na agencia ou por transferencia (enviamos dados se necessario).`;
    }
    
    // Resposta generica sobre pagamento
    return `Aceitamos pagamentos de varias formas:

• **Presencial** na agencia (dinheiro ou cheque)
• **Transferencia bancaria** (enviamos os dados)

Estamos em **Achada Sao Filipe, Praia**, ao lado de Calu e Angela.

Para qual servico deseja fazer o pagamento?`;
  }
  
  // Perguntas sobre precos/custos
  if (lower.includes("quanto custa") || lower.includes("preco") || lower.includes("preco") || 
      lower.includes("valor") || lower.includes("custo")) {
    
    if (session.service === "passagem") {
      return "Estou a verificar as melhores tarifas disponiveis para o seu destino. Assim que tiver o preco exato, informo imediatamente. Enquanto isso, precisa de mais alguma informacao sobre a viagem?";
    }
    
    if (session.service === "formacao") {
      return `**Investimento na Formacao: 45.000 CVE**

Dividido em:
• 6.000 CVE – inscricao
• 39.000 CVE – declaracao de matricula (inclui metade do curso paga)

Em Portugal: apenas 300 euros para concluir
**Nao ha mensalidades!**`;
    }
    
    if (session.service === "agendamento_consular") {
      return `**Valor do Agendamento Consular: 16.940 CVE**

• 12.500 CVE – servico Aventour
• 4.440 CVE – taxa consular`;
    }
    
    if (session.service === "ferias") {
      return `**Agendamento de Ferias: 20.000 CVE**

• 5.000 CVE – reserva inicial
• 15.000 CVE – apos confirmacao

Inclui reserva de passagem e hotel.`;
    }
    
    return `Temos varios servicos com precos diferentes:

• **Formacao em Portugal:** 45.000 CVE
• **Agendamento Consular:** 16.940 CVE
• **Agendamento de Ferias:** 20.000 CVE
• **Passagens Aereas:** consultar tarifa
• **Hotel:** 60 CVE/dia

Qual servico lhe interessa?`;
  }
  
  // Perguntas sobre contacto/horario
  if (lower.includes("contacto") || lower.includes("contato") || lower.includes("telefone") || 
      lower.includes("horario") || lower.includes("horario") || lower.includes("whatsapp")) {
    return `**Contactos Aventour:**

📍 **Morada:** Achada Sao Filipe, Praia (ao lado de Calu e Angela)
📞 **Telefone/WhatsApp:** +238 913 23 75
📧 **Email:** reservas@viagensaventour.com
🕐 **Horario:** Segunda a Sexta, 8h as 17h`;
  }
  
  // Perguntas sobre documentos
  if (lower.includes("documentos") || lower.includes("documento") || lower.includes("papeis") || 
      lower.includes("papel")) {
    if (session.service === "formacao") {
      return `**Documentos necessarios para a Formacao:**

• Passaporte
• CNI (Cartao Nacional de Identidade)
• NIF (Numero de Identificacao Fiscal)
• Certificado do 9o ano apostilado

Pode enviar por:
• Email: reservas@viagensaventour.com
• WhatsApp: +238 913 23 75
• Ou entregar presencialmente na agencia`;
    }
    
    if (session.service === "agendamento_consular") {
      return `**Documentos para Agendamento Consular:**

• Passaporte original
• Comprovativo de pagamento (16.940 CVE)

Deve comparecer presencialmente a agencia em Achada Sao Filipe.`;
    }
    
    return `Os documentos necessarios dependem do servico:

**Formacao:** Passaporte, CNI, NIF, Certificado 9o ano apostilado
**Agendamento Consular:** Passaporte original + comprovativo de pagamento
**Passagem:** Foto do passaporte + NIF

Qual servico pretende?`;
  }
  
  return null;
}

// Deteccao de intencao - SO NO INICIO DA CONVERSA
function detectIntent(text: string): { service: ServiceType; confidence: number } {
  const lower = text.toLowerCase().trim();
  
  // Palavras que indicam mudanca explicita de assunto
  const mudancaExplicita = ["quero", "pretendo", "gostaria", "queria", "desejo", "vamos", "falar de", "falar sobre"];
  const temMudancaExplicita = mudancaExplicita.some(p => lower.includes(p));
  
  if (lower.includes("formacao") || lower.includes("formacao") || lower.includes("estudar") || 
      (lower.includes("curso") && !lower.includes("agendamento")) || 
      (lower.includes("estuda") && !lower.includes("agendamento"))) {
    return { service: "formacao", confidence: temMudancaExplicita ? 0.95 : 0.7 };
  }
  
  if ((lower.includes("passagem") || lower.includes("bilhete") || lower.includes("voo") || 
       lower.includes("aviaum") || lower.includes("aviao") || lower.includes("aviao")) &&
      !lower.includes("reserva de passagem")) {
    return { service: "passagem", confidence: temMudancaExplicita ? 0.95 : 0.7 };
  }
  
  if (lower.includes("ferias") || lower.includes("ferias") || lower.includes("turismo") || lower.includes("lazer")) {
    return { service: "ferias", confidence: temMudancaExplicita ? 0.95 : 0.7 };
  }
  
  if ((lower.includes("agendamento") || lower.includes("visto") || lower.includes("consulado") || 
       lower.includes("consulado") || lower.includes("entrevista")) &&
      !lower.includes("agendamento de ferias") && !lower.includes("agendamento ferias")) {
    return { service: "agendamento_consular", confidence: temMudancaExplicita ? 0.95 : 0.7 };
  }
  
  if (lower.includes("hotel") || lower.includes("hospedagem") || lower.includes("alojamento")) {
    return { service: "reserva_hotel", confidence: temMudancaExplicita ? 0.95 : 0.7 };
  }
  
  if (lower.includes("reservar vaga") || lower.includes("bloquear") || lower.includes("garantir vaga")) {
    return { service: "reserva_passagem", confidence: temMudancaExplicita ? 0.95 : 0.7 };
  }
  
  return { service: "none", confidence: 0 };
}

function extractEmail(text: string): string | null {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/);
  return match ? match[0] : null;
}

function extractPhone(text: string): string | null {
  const match = text.match(/\\+?[0-9\\s-]{9,}/);
  return match ? match[0].replace(/\\s/g, '') : null;
}

// Main Flow Handler
async function handleFlow(senderId: string, messageText: string): Promise<{text: string, material?: Material, quote?: Quote}> {
  const session = await getClientSession(senderId);
  const text = messageText.trim();
  const lowerText = text.toLowerCase();

  console.log(`[${senderId}] "${messageText}" | Servico: ${session.service} | Etapa: ${session.step}`);

  session.history.push({ role: "user", text: messageText });

  // Comando reiniciar
  if (lowerText === "reiniciar" || lowerText === "comecar" || lowerText === "recomeca" || 
      lowerText === "recomecar" || lowerText === "outro" || lowerText === "outro servico") {
    const clean = resetSession(session);
    await saveClientSession(clean);
    return { text: "Entendido. Vamos comecar de novo.\\n\\nPosso ajudar com:\\n1. Formacao em Portugal\\n2. Agendamento de Ferias\\n3. Agendamento Estudante/Contrato\\n4. Passagens Aereas\\n5. Reserva de Hotel\\n\\nQual servico pretende?" };
  }

  // Verifica se e uma pergunta comum primeiro (endereco, pagamento, etc.)
  const commonResponse = getCommonResponse(messageText, session);
  if (commonResponse) {
    // Nao muda o fluxo atual, so responde a pergunta
    await saveClientSession(session);
    return { text: commonResponse };
  }

  // DETECCAO DE INTENCAO - SO NO INICIO (session.service === "none")
  // ou se o usuario explicitamente quer mudar de assunto
  const detectedIntent = detectIntent(messageText);
  
  // So muda de fluxo se:
  // 1. Nao esta em nenhum servico ainda (inicio da conversa)
  // 2. A confianca e muito alta (0.95 = mudanca explicita)
  const podeMudarFluxo = session.service === "none" || detectedIntent.confidence >= 0.95;
  
  if (detectedIntent.service !== "none" && podeMudarFluxo && detectedIntent.service !== session.service) {
    // Inicia novo fluxo
    session.service = detectedIntent.service;
    session.step = "inicio";
    session.data = {};
    await saveClientSession(session);
    
    // Retorna a primeira mensagem do fluxo
    switch (session.service) {
      case "formacao":
        await notifyLead("Novo Interesse - Formacao Portugal", `Cliente: ${senderId}\\nData: ${new Date().toLocaleString()}`);
        return { text: "Excelente escolha. As formacoes em Portugal sao uma oportunidade unica. Para verificar a elegibilidade, qual e a sua idade?" };
        
      case "passagem":
        await notifyLead("Novo Pedido - Passagem", `Cliente: ${senderId}\\nData: ${new Date().toLocaleString()}`);
        return { text: "Vou preparar a melhor opcao para a sua viagem. Qual e o destino?" };
        
      case "ferias":
        await notifyLead("Novo Interesse - Ferias", `Cliente: ${senderId}\\nData: ${new Date().toLocaleString()}`);
        return { text: "Perfeito. O agendamento de ferias inclui reserva de passagem e hotel por 20.000 CVE (5.000 CVE reserva + 15.000 CVE apos confirmacao). E para si ou para outra pessoa?" };
        
      case "agendamento_consular":
        await notifyLead("Novo Interesse - Agendamento", `Cliente: ${senderId}\\nData: ${new Date().toLocaleString()}`);
        if (lowerText.includes("contrato") && !lowerText.includes("agendamento") && !lowerText.includes("visto")) {
          return { text: "No momento nao intermediamos contratos de trabalho diretamente. Cuidamos do agendamento consular, orientacao e acompanhamento.\\n\\nPosso ajudar com o agendamento para contrato de trabalho? E para estudante ou contrato de trabalho?" };
        }
        return { text: "Entendido. O agendamento consular requer presenca presencial na Aventour. O valor total e 16.940 CVE (12.500 CVE servico + 4.440 CVE taxa consular). E para estudante ou contrato de trabalho?" };
        
      case "reserva_hotel":
        await notifyLead("Novo Interesse - Hotel", `Cliente: ${senderId}\\nData: ${new Date().toLocaleString()}`);
        return { text: "A reserva de hotel tem o custo de 60 CVE por dia. Quais sao as datas de entrada e saida?" };
        
      case "reserva_passagem":
        await notifyLead("Novo Interesse - Reserva", `Cliente: ${senderId}\\nData: ${new Date().toLocaleString()}`);
        return { text: "A reserva de passagem custa 1.000 CVE e garante a vaga temporariamente. Qual passagem pretende reservar?" };
    }
  }

  // Se ainda nao tem servico, mostra menu
  if (session.service === "none") {
    return { text: "Ola. Sou consultor comercial da Aventour Viagens. Posso ajudar com:\\n\\n1. Formacao em Portugal\\n2. Agendamento de Ferias\\n3. Agendamento Estudante/Contrato\\n4. Passagens Aereas\\n5. Reserva de Hotel\\n\\nQual servico pretende?" };
  }

  // FLUXO FORMACAO
  if (session.service === "formacao") {
    if (session.step === "inicio" || session.step === "formacao_idade") {
      const idadeNum = parseInt(text);
      if (isNaN(idadeNum)) {
        session.step = "formacao_idade";
        await saveClientSession(session);
        return { text: "Por favor, informe a sua idade em numeros (ex: 25)." };
      }
      
      session.data.idade = String(idadeNum);
      
      if (idadeNum < 18) {
        session.step = "formacao_menor";
        await saveClientSession(session);
        return { text: "Para menores de 18 anos, nao temos formacao direta. Pode adicionar o menor no pedido de visto com documentos adicionais. E melhor passar na agencia para avaliarmos o caso." };
      }
      
      session.step = "formacao_escolaridade";
      await saveClientSession(session);
      return { text: "Obrigado. Qual foi o ultimo ano de escolaridade que concluiu?" };
    }

    if (session.step === "formacao_escolaridade") {
      session.data.escolaridade = text;
      session.step = "formacao_curso";
      await saveClientSession(session);
      return { text: "Perfeito. Temos cursos em areas com alta empregabilidade:\\n\\n- Auxiliar de Acao Educativa\\n- Auxiliar de Acao Medica\\n- Profissional de Turismo\\n- Marketing Digital\\n- Assistente de Contabilidade\\n- Assistente Administrativo\\n\\nQual area mais lhe interessa?" };
    }

    if (session.step === "formacao_curso") {
      session.data.curso = text;
      session.step = "formacao_confirmacao";
      await saveClientSession(session);
      
      return { text: `Entao vamos avancar com o proximo passo.

Proximos passos - ${text}

1. Documentos necessarios
Para iniciar, envia:
- Passaporte
- CNI
- NIF
- Certificado do 9o ano apostilado

Envio dos documentos:
Email: reservas@viagensaventour.com
WhatsApp: +238 913 23 75
(ou podes entregar presencialmente na agencia)

2. Duracao da formacao
1 ano
Aulas teoricas em Lisboa
Estagio incluido

3. Pagamento
45.000 CVE, dividido em:
6.000 CVE - inscricao
39.000 CVE - declaracao de matricula
(ja inclui metade do curso paga)

O valor de 39.000 CVE e recebido apenas em cheque ou dinheiro (presencialmente).
Em Portugal, pagas apenas 300 euros para concluir o valor total do curso.
Nao ha mensalidades.

Assim que enviares os documentos, confirmamos tudo e damos seguimento a inscricao.
Diz-me quando consegues enviar que eu acompanho passo a passo.` };
    }

    if (session.step === "formacao_confirmacao") {
      if (lowerText.includes("pacote") || lowerText.includes("completo")) {
        return { text: "Temos tambem um pacote completo que inclui agendamento, inscricao e metade da formacao paga por 61.990 CVE. So paga os 300 euros em Portugal. Quer optar por este pacote ou pelo basico de 45.000 CVE?" };
      }
      
      if (lowerText.includes("tenho") || lowerText.includes("manda") || lowerText.includes("envia")) {
        await notifyAppCentral("documentos_recebidos", senderId, `Cliente tem documentos prontos para formacao - ${session.data.curso}`, {
          clientName: "Cliente",
          curso: session.data.curso,
          idade: session.data.idade,
          escolaridade: session.data.escolaridade
        });
        
        return { text: "Perfeito. Ja registei que tens os documentos prontos. Podes enviar quando quiser por email, WhatsApp ou entregar presencialmente na agencia. Assim que recebermos, damos seguimento imediato a tua inscricao." };
      }
      
      return { text: "Entendido. Assim que tiveres os documentos prontos, envia que damos seguimento imediato. Precisa de mais alguma informacao?" };
    }
  }

  // FLUXO PASSAGEM
  if (session.service === "passagem") {
    if (session.step === "inicio" || session.step === "passagem_destino") {
      session.data.destino = text;
      session.step = "passagem_data";
      await saveClientSession(session);
      return { text: "Qual e a data pretendida para a viagem?" };
    }

    if (session.step === "passagem_data") {
      session.data.data = text;
      session.step = "passagem_pessoas";
      await saveClientSession(session);
      return { text: "Quantas pessoas vao viajar?" };
    }

    if (session.step === "passagem_pessoas") {
      session.data.pessoas = text;

      const newQuote: Quote = {
        id: `quote_${Date.now()}`,
        clientId: senderId,
        clientName: "Cliente",
        destination: session.data.destino,
        details: `Data: ${session.data.data}, Pessoas: ${text}`,
        status: "pending",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const quotes = await readJsonFile<Quote[]>(quotesPath, []);
      quotes.push(newQuote);
      await writeJsonFile(quotesPath, quotes);

      session.quoteId = newQuote.id;
      session.step = "passagem_aguardando_preco";
      await saveClientSession(session);

      await notifyLead("Passagem - Cotacao solicitada", `Destino: ${session.data.destino}\\nData: ${session.data.data}\\nPessoas: ${text}`);

      return { text: "Ja registei o seu pedido. A nossa equipa comercial esta a verificar as melhores tarifas disponiveis. Ja verifico e lhe digo o preco.", quote: newQuote };
    }

    if (session.step === "passagem_aguardando_preco") {
      return { text: "Ja verifico as melhores tarifas e lhe digo o preco em breve. Precisa de mais alguma informacao?" };
    }
    
    if (session.step === "passagem_cotacao_enviada") {
      // Cliente ja recebeu cotacao, pode estar perguntando sobre pagamento ou confirmando
      if (lowerText.includes("opcao 1") || lowerText.includes("presencial") || lowerText.includes("vou ai") || lowerText.includes("vou aí")) {
        return { text: "Perfeito! Estamos em **Achada Sao Filipe, Praia**, ao lado de Calu e Angela. Horario: segunda a sexta, 8h as 17h. Aguardamos a sua visita!" };
      }
      
      if (lowerText.includes("opcao 2") || lowerText.includes("online") || lowerText.includes("transferencia") || lowerText.includes("nao posso ir") || lowerText.includes("não posso ir")) {
        return { text: "Entendido! Vou enviar os dados bancarios para pagamento. Um momento...\\n\\n**Dados para transferencia:**\\n[BANCO: CAIXA ECONOMICA DE CABO VERDE]\\n[CONTA: ...]\\n\\nAssim que fizer o pagamento, envie o comprovante + foto do passaporte + NIF." };
      }
      
      return { text: "Estou aqui para ajudar com a sua passagem. Ja enviei a cotacao acima. Prefere a **Opcao 1 (Presencial)** ou **Opcao 2 (Online)**?" };
    }
  }

  // FLUXO FERIAS
  if (session.service === "ferias") {
    if (session.step === "inicio" || session.step === "ferias_tipo_pessoa") {
      session.data.para_quem = text;
      session.step = "ferias_email";
      await saveClientSession(session);
      return { text: "Entendido. Qual e o email para enviarmos a confirmacao?" };
    }

    if (session.step === "ferias_email") {
      const email = extractEmail(messageText);
      session.data.email = email || text;
      session.step = "ferias_telefone";
      await saveClientSession(session);
      return { text: "Perfeito. Qual e o numero de telefone?" };
    }

    if (session.step === "ferias_telefone") {
      const phone = extractPhone(messageText);
      session.data.telefone = phone || text;
      session.step = "ferias_trabalho";
      await saveClientSession(session);
      return { text: "Obrigado. Qual e o local de trabalho?" };
    }

    if (session.step === "ferias_trabalho") {
      session.data.local_trabalho = text;
      session.step = "ferias_morada";
      await saveClientSession(session);
      return { text: "Qual e a morada completa?" };
    }

    if (session.step === "ferias_morada") {
      session.data.morada = text;
      await notifyLead("Ferias - Lead completo", `Para: ${session.data.para_quem}\\nEmail: ${session.data.email}\\nTel: ${session.data.telefone}\\nTrabalho: ${session.data.local_trabalho}\\nMorada: ${session.data.morada}`);
      return { text: "Excelente. Ja registei tudo. A nossa equipa vai contactar em ate 24h para confirmar o agendamento." };
    }
  }

  // FLUXO AGENDAMENTO CONSULAR
  if (session.service === "agendamento_consular") {
    if (session.step === "inicio" || session.step === "agendamento_tipo") {
      // Detecta se e estudante ou contrato
      if (lowerText.includes("estudante")) {
        session.data.tipo = "estudante";
      } else if (lowerText.includes("contrato")) {
        session.data.tipo = "contrato";
      } else {
        // Se nao disse claramente, pergunta de novo
        return { text: "Para confirmar: e para **estudante** ou **contrato de trabalho**?" };
      }
      
      session.step = "agendamento_disponibilidade";
      await saveClientSession(session);
      return { text: "Qual e a disponibilidade para o atendimento presencial? (Ex: esta semana, proxima semana)" };
    }

    if (session.step === "agendamento_disponibilidade") {
      session.data.disponibilidade = text;
      await notifyLead("Agendamento", `Tipo: ${session.data.tipo}\\nDisponibilidade: ${text}`);
      return { text: "Agendamento registado. Deve comparecer a Aventour em **Achada Sao Filipe, Praia** (ao lado de Calu e Angela) com o passaporte original e comprovativo de pagamento (12.500 CVE + 4.440 CVE). A nossa equipa vai confirmar a data exata em breve." };
    }
  }

  // FLUXO HOTEL
  if (session.service === "reserva_hotel") {
    if (session.step === "inicio" || session.step === "hotel_datas") {
      session.data.datas = text;
      session.step = "hotel_local";
      await saveClientSession(session);
      return { text: "Qual e o destino/hotel pretendido?" };
    }

    if (session.step === "hotel_local") {
      session.data.local = text;
      await notifyLead("Hotel - Reserva solicitada", `Datas: ${session.data.datas}\\nLocal: ${session.data.local}`);
      return { text: `Registado. Vamos verificar disponibilidade para ${session.data.local}. Custo: 60 CVE/dia. A equipa contacta em breve.` };
    }
  }

  // FLUXO RESERVA PASSAGEM
  if (session.service === "reserva_passagem") {
    await notifyLead("Reserva de Passagem (bloqueio)", `Detalhes: ${text}`);
    return { text: "Pedido de reserva registado. Deve efetuar o pagamento de 1.000 CVE para garantir a vaga. A nossa equipa vai confirmar em breve." };
  }

  // Fallback melhorado - NUNCA repete a mesma mensagem
  return { text: `Entendi. Estou aqui para ajudar! 😊

Posso esclarecer sobre:
• Precos e formas de pagamento
• Documentos necessarios  
• Localizacao da agencia (Achada Sao Filipe, Praia)
• Contactos (+238 913 23 75)
• Prazos e duracao dos servicos

Ou escreva **reiniciar** para falar de outro servico (passagens, formacao, agendamento, etc).` };
}

// Routes
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || "aventour_token_123";
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  const body = req.body;
  if (body.object !== "page") return res.sendStatus(404);

  res.sendStatus(200);

  setImmediate(async () => {
    try {
      for (const entry of body.entry || []) {
        for (const event of entry.messaging || []) {
          if (event.message?.is_echo || event.delivery || event.read) continue;

          const senderId = event.sender?.id;
          const messageText = event.message?.text;
          const mid = event.message?.mid;

          if (mid) {
            if (processedMessageIds.has(mid)) {
              console.log(`Ignorando mensagem duplicada: ${mid}`);
              continue;
            }
            processedMessageIds.add(mid);
            if (processedMessageIds.size % 10 === 0) {
              await saveProcessedMessages();
            }
          }

          if (!senderId || !messageText) continue;

          console.log(`[${senderId}]: "${messageText}"`);

          try {
            const result = await handleFlow(senderId, messageText);
            await sendMessengerMessage(senderId, result.text, result.material);
            console.log(`Resposta enviada para ${senderId}`);
          } catch (error) {
            console.error("Erro processando mensagem:", error);
          }
        }
      }
    } catch (error) {
      console.error("Erro geral no webhook:", error);
    }
  });
});

app.post("/api/process-message", async (req, res) => {
  try {
    const { text, senderId, conversationId } = req.body;
    const id = senderId || conversationId || `web_${Date.now()}`;

    if (!text) return res.status(400).json({ error: "Texto obrigatorio" });

    const result = await handleFlow(id, text);

    res.json({ 
      replyText: result.text, 
      material: result.material,
      quote: result.quote,
      senderId: id 
    });
  } catch (error) {
    console.error("Erro API:", error);
    res.status(500).json({ 
      replyText: "Tivemos um problema tecnico. Escreva 'reiniciar' para tentarmos novamente." 
    });
  }
});

app.get("/api/quotes", async (_req, res) => {
  const quotes = await readJsonFile<Quote[]>(quotesPath, []);
  res.json(quotes.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
});

app.post("/api/quotes", async (req, res) => {
  const quotes = await readJsonFile<Quote[]>(quotesPath, []);
  const newQuote: Quote = {
    ...req.body,
    id: req.body.id || `quote_${Date.now()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const existingIndex = quotes.findIndex(q => q.id === newQuote.id);
  if (existingIndex >= 0) {
    quotes[existingIndex] = newQuote;
  } else {
    quotes.push(newQuote);
  }

  await writeJsonFile(quotesPath, quotes);
  res.json(newQuote);
});

// Endpoint para enviar cotacao ao cliente (chamado pelo painel)
app.post("/api/quotes/:id/send", async (req, res) => {
  try {
    const { price, observation } = req.body;
    
    if (!price) {
      return res.status(400).json({ error: "Preco obrigatorio" });
    }

    const result = await sendQuoteToClient(req.params.id, price, observation);
    res.json(result);
  } catch (error) {
    console.error("Erro endpoint send quote:", error);
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get("/api/sessions", async (_req, res) => {
  const activeSessions = Object.values(sessions)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  res.json(activeSessions);
});

app.get("/api/session/:senderId", async (req, res) => {
  const session = await getClientSession(req.params.senderId);
  res.json(session);
});

app.post("/api/session/:senderId/reset", async (req, res) => {
  const session = await getClientSession(req.params.senderId);
  const clean = resetSession(session);
  await saveClientSession(clean);
  res.json({ success: true });
});

app.get("/api/materials", async (_req, res) => {
  const materials = await readJsonFile<Material[]>(materialsPath, []);
  res.json(materials);
});

app.post("/api/materials", async (req, res) => {
  await writeJsonFile(materialsPath, req.body);
  res.json({ success: true });
});

app.get("/api/campaigns", async (_req, res) => {
  const campaigns = await readJsonFile<Campaign[]>(campaignsPath, []);
  res.json(campaigns);
});

app.post("/api/campaigns", async (req, res) => {
  await writeJsonFile(campaignsPath, req.body);
  res.json({ success: true });
});

app.get("/api/notifications", async (_req, res) => {
  const notifications = await readJsonFile<Notification[]>(notificationsPath, []);
  res.json(notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
});

app.post("/api/notifications/:id/read", async (req, res) => {
  const notifications = await readJsonFile<Notification[]>(notificationsPath, []);
  const index = notifications.findIndex(n => n.id === req.params.id);
  if (index >= 0) {
    notifications[index].read = true;
    await writeJsonFile(notificationsPath, notifications);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: "Notificacao nao encontrada" });
  }
});

app.get("/api/notifications/unread", async (_req, res) => {
  const notifications = await readJsonFile<Notification[]>(notificationsPath, []);
  const unread = notifications.filter(n => !n.read);
  res.json(unread);
});

app.post("/api/notify", async (req, res) => {
  try {
    const { subject, body } = req.body;
    await notifyLead(subject, body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    activeSessions: Object.keys(sessions).length,
    processedMessages: processedMessageIds.size
  });
});

app.get("/privacy-policy", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html><html lang="pt"><head><title>Politica de Privacidade - Aventour</title></head><body style="font-family: Arial; max-width: 800px; margin: 40px auto; padding: 0 16px;"><h1>Politica de Privacidade</h1><p>Dados recolhidos: nome, telefone, email, mensagens, documentos quando necessarios.</p><p>Contacto: reservas@viagensaventour.com</p></body></html>`);
});

app.get("/data-deletion", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html><html lang="pt"><head><title>Remocao de Dados - Aventour</title></head><body style="font-family: Arial; max-width: 800px; margin: 40px auto; padding: 0 16px;"><h1>Remocao de Dados</h1><p>Envie email para: <strong>reservas@viagensaventour.com</strong></p></body></html>`);
});

async function start() {
  await ensureDataFiles();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Aventour Server rodando em http://localhost:${PORT}`);
    console.log(`Notificacoes: ${NOTIFY_EMAIL}`);
    console.log(`Resend: ${process.env.RESEND_API_KEY ? "OK" : "NAO CONFIGURADO"}`);
    console.log(`Mensagens processadas: ${processedMessageIds.size}`);
  });
}

start();


