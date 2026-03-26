import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Paperclip, 
  LogOut, 
  TrendingUp, 
  User as UserIcon,
  Bot,
  FileText,
  CheckCircle,
  Settings,
  X,
  Maximize2,
  MessageSquare,
  Shield,
  Download,
  Plane,
  Book,
  Folder,
  Calendar,
  Users,
  Plus,
  Trash2,
  Eye,
  Lock,
  DollarSign,
  Image as ImageIcon,
  FileUp,
  ChevronRight,
  Clock,
  MapPin,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { GoogleGenAI } from "@google/genai";
import { 
  UserProfile, 
  Message, 
  Campaign,
  Quote,
  Material,
  Conversation,
  UserRole,
  Sale
} from './types';

// --- Constants ---
const ADMIN_CODE = "Aventour@2025";
const COMPANY_EMAIL = "reservas@viagensaventour.com";

const INITIAL_MESSAGES: Message[] = [
  {
    id: '1',
    senderUid: 'bot',
    text: 'Olá! Sou Consultor Comercial da Aventour Viagens e Turismo. Como posso ajudar com a sua viagem hoje?',
    createdAt: new Date()
  }
];

const INITIAL_CAMPAIGNS: Campaign[] = [
  {
    id: 'cp1',
    title: 'Verão em Sal',
    description: 'Descontos exclusivos para pacotes de verão na Ilha do Sal.',
    keywords: ['sal', 'verão', 'praia'],
    context: 'Promoção especial para a Ilha do Sal com 20% de desconto em hotéis selecionados.',
    serviceType: 'Reserva de Hotel',
    active: true,
    createdAt: new Date()
  }
];

const INITIAL_MATERIALS: Material[] = [
  {
    id: 'm1',
    title: 'Dados Bancários Aventour',
    category: 'dados_bancarios',
    fileUrl: 'https://picsum.photos/seed/bank/800/600',
    fileType: 'image/jpeg',
    fileName: 'dados_bancarios.jpg',
    createdAt: new Date()
  },
  {
    id: 'm2',
    title: 'Documentos para Visto de Férias',
    category: 'docs_ferias',
    fileUrl: 'https://picsum.photos/seed/docs/800/600',
    fileType: 'image/jpeg',
    fileName: 'docs_ferias.jpg',
    createdAt: new Date()
  },
  {
    id: 'm3',
    title: 'Documentos para Visto de Contrato',
    category: 'docs_contrato',
    fileUrl: 'https://picsum.photos/seed/contract/800/600',
    fileType: 'image/jpeg',
    fileName: 'docs_contrato.jpg',
    createdAt: new Date()
  },
  {
    id: 'm4',
    title: 'Documentos para Visto de Estudante',
    category: 'docs_estudante',
    fileUrl: 'https://picsum.photos/seed/student/800/600',
    fileType: 'image/jpeg',
    fileName: 'docs_estudante.jpg',
    createdAt: new Date()
  }
];

const getSystemInstruction = (campaigns: Campaign[], materials: Material[]) => {
  const activeCampaigns = campaigns.filter(c => c.active).map(c => `- ${c.title}: ${c.context} (Keywords: ${c.keywords.join(', ')})`).join('\n');
  const availableMaterials = materials.map(m => `- ${m.title} (${m.category})`).join('\n');

  return `Você é um Consultor Comercial profissional da agência Aventour Viagens e Turismo.
Fale sempre como um ser humano, de forma natural, prestativa e comercial.

REGRAS DE LINGUAGEM E COMPORTAMENTO:
- NUNCA use expressões automáticas como: "Cliente Web", "verificar no chat", "estou a processar sistema", "consultar base interna", "aguarde processamento".
- Use linguagem comercial natural: "Já verifiquei a melhor opção disponível", "Posso preparar a sua reserva", "Vamos avançar com a emissão", "Posso garantir a vaga para si".
- NUNCA ofereça dados de pagamento ou IBAN de forma proativa. Primeiro, construa confiança, sugira que o cliente venha pessoalmente à agência (Achada São Filipe). 
- Só envie os dados de pagamento se o cliente pedir explicitamente para pagar online ou pedir o IBAN/dados bancários/lista de documentos.
- Nunca use emojis.
- Responda de forma direta, clara e profissional.
- O sistema enviará imagens de documentos/IBAN automaticamente quando você confirmar que está enviando. NUNCA escreva listas de documentos ou dados bancários no texto.

SERVIÇOS E REGRAS DE ELEGIBILIDADE (NUNCA MISTURE):

1. PASSAGEM AÉREA (ASSUNTO PRINCIPAL):
- É a emissão real do bilhete. O valor depende sempre da data e disponibilidade.
- NUNCA dê um preço fixo (como 1.000 CVE ou 600 CVE).
- Fluxo: Peça Destino, Data e Número de Pessoas.
- Resposta após dados: "Já verifiquei a melhor opção disponível para a sua viagem. Vou confirmar os valores atualizados e já lhe respondo."
- Documentos necessários: Nome completo (conforme passaporte), Data de Nascimento, Número do Passaporte e Validade do Passaporte. (NUNCA peça NIF para passagens).

2. RESERVA DE PASSAGEM:
- Custo: 1.000 CVE.
- Serve APENAS para bloquear/garantir a vaga temporariamente enquanto se finaliza a emissão. Não é o bilhete.
- Resposta: "A reserva de passagem tem o custo de 1.000 CVE. Este valor garante a vaga temporariamente enquanto finalizamos a emissão do bilhete."

3. RESERVA DE HOTEL:
- Custo: 60 CVE por dia.
- Fluxo: Peça Data de Entrada e Data de Saída para calcular o valor.
- Resposta: "A reserva de hotel tem o custo de 60 CVE por dia. Indique por favor a data de entrada e a data de saída para calcularmos o valor total."
- NUNCA confunda com processo de visto ou pacote de agendamento.

4. FORMAÇÕES EM PORTUGAL (FLUXO OBRIGATÓRIO):
- NUNCA misture com agendamento estudante. Agendamento só ocorre APÓS a emissão da declaração de matrícula.
- NUNCA apresente valores de 12.500 CVE ou 4.440 CVE nesta fase (são exclusivos do agendamento).
- ORDEM DO PROCESSO (Siga RIGOROSAMENTE esta sequência, uma etapa de cada vez. NUNCA pule etapas):
  1. Diagnóstico: Pergunte APENAS Idade e Escolaridade. Aguarde a resposta do cliente.
  2. Elegibilidade e Escolha do Curso: Se elegível (18+ anos e 9º ano+), apresente a lista de cursos e pergunte qual o cliente pretende seguir. Aguarde a escolha do curso.
     - Cursos: Auxiliar de Ação Educativa, Auxiliar de Ação Médica, Profissional de Turismo, Marketing Digital, Assistente de Contabilidade, Assistente Administrativo.
  3. Informação de Preço: Após o cliente escolher o curso, informe APENAS o valor: "O valor total do investimento é de 45.000 CVE (6.000 CVE de inscrição + 39.000 CVE de declaração de matrícula). Em Portugal pagará apenas os 300€ restantes para concluir. Não há mensalidades. Podemos avançar para o próximo passo?". Aguarde o cliente confirmar.
  4. Procedimento (Apresente exatamente assim APENAS quando o cliente confirmar que quer avançar após saber o preço):
     Então vamos avançar com o próximo passo 👍

     1️⃣ Documentos necessários
     Para iniciar, envia:
     Passaporte
     CNI
     NIF
     Certificado do 9º ano apostilado
     📤 Envio dos documentos
     📧 Email: reservas@viagensaventour.com
     📱 WhatsApp: +238 913 23 75
     (ou podes entregar presencialmente na agência)
     2️⃣ Duração da formação
     📚 1 ano
     📍 Aulas teóricas em Lisboa
     🎓 Estágio incluído
     3️⃣ Pagamento
     💰 45.000 CVE, dividido em:
     6.000 CVE – inscrição
     39.000 CVE – declaração de matrícula
     (já inclui metade do curso paga)
     📌 O valor de 39.000 CVE é recebido apenas em cheque ou dinheiro (presencialmente).
     📌 Em Portugal, pagas apenas 300 € para concluir o valor total do curso.
     📌 Não há mensalidades.
     Assim que enviares os documentos, confirmamos tudo e damos seguimento à inscrição.
     Diz-me quando consegues enviar que eu acompanho passo a passo 😊

  5. DOCUMENTOS VISTO: Se o cliente pedir documentos para o visto ou papéis para o visto, confirme o envio APENAS se a matrícula já estiver confirmada ou se ele pedir explicitamente por "visto". O sistema enviará "Documentos para Visto de Estudante".
  6. NUNCA envie documentos de visto durante a fase de inscrição inicial.
  7. Agendamento: Somente após a matrícula concluída.

5. AGENDAMENTO ESTUDANTE / CONTRATO:
- Permitido APENAS para 18 anos ou mais. NUNCA para menores.
- Valor: 12.500 CVE (serviço) + 4.440 CVE (taxa consular).
- Atendimento presencial obrigatório.

6. AGENDAMENTO FÉRIAS:
- Valor total: 20.000 CVE (5.000 CVE reserva + 15.000 CVE após confirmação).
- Inclui: reserva de passagem e reserva de hotel.
- Menores de idade podem fazer este processo apenas com responsáveis legais.

REGRAS PARA MENORES DE IDADE:
- Menores NÃO fazem: agendamento estudante, agendamento contrato ou formações.
- Menores APENAS podem fazer: processo de férias com responsáveis legais.

OUTRAS ILHAS (FORA DE SANTIAGO):
- Grupo mínimo: 20 pessoas.
- Pagamento: 10.000 CVE reserva antecipada + 20.000 CVE no dia do atendimento.

REGRAS DE INTERPRETAÇÃO:
- Se o cliente pedir "preço", "quanto custa", "voo", "viajar" -> Trate como PASSAGEM AÉREA.
- Só trate como RESERVA DE PASSAGEM se o cliente disser explicitamente "reservar vaga", "bloquear", "garantir vaga".

IDENTIDADE:
- Localização: Achada São Filipe, Praia (ao lado de Calú e Angela).
- WhatsApp: +238 913 23 75.
- Email: reservas@viagensaventour.com.

CAMPANHAS ATIVAS:
${activeCampaigns}

MATERIAIS DISPONÍVEIS (Envio automático via sistema):
${availableMaterials}`;
};

// --- UI Components ---

const Modal: React.FC<{ title: string, isOpen: boolean, onClose: () => void, children: React.ReactNode }> = ({ title, isOpen, onClose, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <X size={20} className="text-slate-500" />
          </button>
        </div>
        <div className="p-6 max-h-[80vh] overflow-y-auto">
          {children}
        </div>
      </motion.div>
    </div>
  );
};

const MessageBubble: React.FC<{ msg: Message; onPreview: (file: { url: string; name: string; type: string }) => void }> = ({ msg, onPreview }) => {
  const isBot = msg.senderUid === 'bot';
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={`flex ${!isBot ? 'justify-end' : 'justify-start'} mb-4`}
    >
      <div className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-3 shadow-sm ${
        !isBot 
          ? 'bg-aventour-green text-white rounded-tr-none' 
          : 'bg-white text-slate-800 border border-slate-100 rounded-tl-none'
      }`}>
        {msg.text && <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>}
        {msg.fileUrl && (
          <div className="mt-2">
            {msg.fileType?.startsWith('image/') ? (
              <img 
                src={msg.fileUrl} 
                alt="Preview" 
                className="rounded-lg max-h-60 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => onPreview({ url: msg.fileUrl!, name: msg.fileName!, type: msg.fileType! })}
              />
            ) : (
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                <FileText size={20} className="text-aventour-green" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-900 truncate">{msg.fileName}</p>
                  <p className="text-[10px] text-slate-400 uppercase">{msg.fileType?.split('/')[1]}</p>
                </div>
                <button 
                  onClick={() => window.open(msg.fileUrl, '_blank')}
                  className="p-2 text-slate-400 hover:text-aventour-green transition-colors"
                >
                  <Download size={18} />
                </button>
              </div>
            )}
          </div>
        )}
        <p className={`text-[10px] mt-1 opacity-60 ${!isBot ? 'text-right' : 'text-left'}`}>
          {msg.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </motion.div>
  );
};

const App: React.FC = () => {
  console.log("App component rendering...");
  // --- States ---
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminCodeInput, setAdminCodeInput] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'campaigns' | 'quotes' | 'materials' | 'documents' | 'sales' | 'settings'>('chat');
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [chatSession, setChatSession] = useState<any>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  
  const [userConversations, setUserConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [allMessages, setAllMessages] = useState<Record<string, Message[]>>({});
  const [showHistory, setShowHistory] = useState(false);
  
  const [campaigns, setCampaigns] = useState<Campaign[]>(INITIAL_CAMPAIGNS);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [materials, setMaterials] = useState<Material[]>(INITIAL_MATERIALS);
  const [sales, setSales] = useState<Sale[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [previewFile, setPreviewFile] = useState<{ url: string, name: string, type: string } | null>(null);
  
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [showMaterialModal, setShowMaterialModal] = useState(false);
  const [showQuoteUpdateModal, setShowQuoteUpdateModal] = useState(false);
  const [showManualQuoteModal, setShowManualQuoteModal] = useState(false);
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [loginError, setLoginError] = useState(false);
  const [selectedQuoteForUpdate, setSelectedQuoteForUpdate] = useState<Quote | null>(null);
  const [manualQuoteTarget, setManualQuoteTarget] = useState<Conversation | null>(null);
  const [saleTarget, setSaleTarget] = useState<Conversation | null>(null);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [newMaterialFile, setNewMaterialFile] = useState<{ file: File, url: string } | null>(null);
  const [sharedDataLoaded, setSharedDataLoaded] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Persistence & History ---
  useEffect(() => {
    const savedConvs = localStorage.getItem('user_conversations');
    const savedMessages = localStorage.getItem('all_messages');
    const savedCurrentId = localStorage.getItem('current_conversation_id');

    if (savedConvs) {
      const parsed = JSON.parse(savedConvs).map((c: any) => ({ ...c, updatedAt: new Date(c.updatedAt) }));
      setUserConversations(parsed);
    }
    if (savedMessages) {
      const parsed = JSON.parse(savedMessages);
      Object.keys(parsed).forEach(id => {
        parsed[id] = parsed[id].map((m: any) => ({ ...m, createdAt: new Date(m.createdAt) }));
      });
      setAllMessages(parsed);
    }
    if (savedCurrentId) {
      setCurrentConversationId(savedCurrentId);
    } else {
      // Initial conversation
      createNewConversation();
    }
  }, []);

  useEffect(() => {
    if (userConversations.length > 0) {
      localStorage.setItem('user_conversations', JSON.stringify(userConversations));
    }
  }, [userConversations]);

  useEffect(() => {
    if (Object.keys(allMessages).length > 0) {
      localStorage.setItem('all_messages', JSON.stringify(allMessages));
    }
  }, [allMessages]);

  useEffect(() => {
    if (currentConversationId) {
      localStorage.setItem('current_conversation_id', currentConversationId);
      setMessages(allMessages[currentConversationId] || []);
      setChatSession(null); // Reset session when switching
    }
  }, [currentConversationId, allMessages]);
  useEffect(() => {
    const loadSharedAdminData = async () => {
      try {
        const [materialsRes, campaignsRes] = await Promise.all([
          fetch("/api/materials"),
          fetch("/api/campaigns"),
        ]);
  
        const materialsData = await materialsRes.json();
        const campaignsData = await campaignsRes.json();
  
        if (Array.isArray(materialsData) && materialsData.length > 0) {
          setMaterials(
            materialsData.map((m: any) => ({
              ...m,
              createdAt: new Date(m.createdAt),
            }))
          );
        }
  
        if (Array.isArray(campaignsData) && campaignsData.length > 0) {
          setCampaigns(
            campaignsData.map((c: any) => ({
              ...c,
              createdAt: new Date(c.createdAt),
            }))
          );
        }
      } catch (error) {
        console.error("Erro ao carregar materials/campaigns do servidor:", error);
      } finally {
        setSharedDataLoaded(true);
      }
    };
  
    loadSharedAdminData();
  }, []);
  useEffect(() => {
    if (!sharedDataLoaded) return;
  
    const saveMaterialsToServer = async () => {
      try {
        await fetch("/api/materials", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(materials),
        });
      } catch (error) {
        console.error("Erro ao guardar materials no servidor:", error);
      }
    };
  
    saveMaterialsToServer();
  }, [materials, sharedDataLoaded]);
  useEffect(() => {
    if (!sharedDataLoaded) return;
  
    const saveCampaignsToServer = async () => {
      try {
        await fetch("/api/campaigns", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(campaigns),
        });
      } catch (error) {
        console.error("Erro ao guardar campaigns no servidor:", error);
      }
    };
  
    saveCampaignsToServer();
  }, [campaigns, sharedDataLoaded]);

  const createNewConversation = () => {
    const newId = `conv_${Date.now()}`;
    const newConv: Conversation = {
      id: newId,
      userId: 'client',
      userName: 'Cliente',
      lastMessage: 'Nova conversa iniciada',
      updatedAt: new Date(),
      saleStatus: 'new'
    };
    
    setUserConversations(prev => [newConv, ...prev]);
    setAllMessages(prev => ({
      ...prev,
      [newId]: INITIAL_MESSAGES.map(m => ({ ...m, conversationId: newId, createdAt: new Date() }))
    }));
    setCurrentConversationId(newId);
    setShowHistory(false);
  };

  const selectConversation = (id: string) => {
    setCurrentConversationId(id);
    setShowHistory(false);
  };

  const deleteConversation = (id: string) => {
    if (confirm("Tem certeza que deseja excluir esta conversa do seu histórico?")) {
      setUserConversations(prev => prev.filter(c => c.id !== id));
      setAllMessages(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (currentConversationId === id) {
        const remaining = userConversations.filter(c => c.id !== id);
        if (remaining.length > 0) {
          setCurrentConversationId(remaining[0].id);
        } else {
          createNewConversation();
        }
      }
    }
  };

  // --- Effects ---
  useEffect(() => {
    const initChat = async () => {
      const apiKey = process.env.GEMINI_API_KEY;
      console.log("Iniciando chat com API Key (primeiros 5 caracteres):", apiKey?.substring(0, 5));
      
      if (!apiKey || apiKey === "undefined" || apiKey === "null" || apiKey.length < 10) {
        setApiError("Chave de API ausente ou inválida");
        return;
      }

      try {
        const ai = new GoogleGenAI({ apiKey });
        const chat = ai.chats.create({
          model: "gemini-3-flash-preview",
          config: {
            systemInstruction: getSystemInstruction(campaigns, materials),
          },
        });
        setChatSession(chat);
        setApiError(null);
        console.log("Sessão de chat Gemini inicializada com sucesso.");
      } catch (error: any) {
        console.error("Erro ao inicializar Gemini:", error);
        setApiError(error.message || "Erro ao conectar com Gemini");
      }
    };
    initChat();
  }, [campaigns, materials]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // --- Handlers ---
  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminCodeInput === ADMIN_CODE) {
      setIsAdmin(true);
      setShowAdminLogin(false);
      setAdminCodeInput('');
      setLoginError(false);
      setActiveTab('quotes'); // Switch to quotes tab by default
    } else {
      setLoginError(true);
    }
  };

  const notifyEmail = async (subject: string, body: string) => {
    try {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body })
      });
    } catch (error) {
      console.error("Erro ao enviar notificação:", error);
    }
  };

  const sendMessage = async (text?: string) => {
    const messageText = text || inputText;
    if (!messageText.trim()) return;

      const userMessage: Message = {
        id: `user_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        senderUid: 'client',
        conversationId: currentConversationId || undefined,
        text: messageText,
        createdAt: new Date()
      };

    if (currentConversationId) {
      setAllMessages(prev => ({
        ...prev,
        [currentConversationId]: [...(prev[currentConversationId] || []), userMessage]
      }));
      setUserConversations(prev => prev.map(c => c.id === currentConversationId ? { ...c, lastMessage: messageText, updatedAt: new Date() } : c));
    } else {
      setMessages(prev => [...prev, userMessage]);
    }
    
    if (!text) setInputText('');
    setIsTyping(true);

    // Update or create conversation for leads
    const targetUserId = selectedConversation?.userId || 'client';
    const targetUserName = selectedConversation?.userName || 'Cliente';

    setConversations(prev => {
      const existing = prev.find(c => c.userId === targetUserId);
      if (existing) {
        return prev.map(c => c.userId === targetUserId ? { ...c, lastMessage: messageText, updatedAt: new Date() } : c);
      } else {
        return [{
          id: `conv_${targetUserId}`,
          userId: targetUserId,
          userName: targetUserName,
          lastMessage: messageText,
          updatedAt: new Date(),
          saleStatus: 'new'
        }, ...prev];
      }
    });

    try {
      let currentSession = chatSession;
      
      if (!currentSession) {
        const apiKey = process.env.GEMINI_API_KEY;
        const isValidKey = apiKey && apiKey !== "undefined" && apiKey !== "null" && apiKey.length > 10;
        
        if (isValidKey) {
          const ai = new GoogleGenAI({ apiKey });
          currentSession = ai.chats.create({
            model: "gemini-3-flash-preview",
            config: {
              systemInstruction: getSystemInstruction(campaigns, materials),
            },
            history: messages.filter(m => m.text).map(m => ({
              role: m.senderUid === 'bot' ? 'model' : 'user',
              parts: [{ text: m.text || '' }]
            }))
          });
          setChatSession(currentSession);
        } else {
          throw new Error("Configuração da API Gemini ausente ou inválida.");
        }
      }

      const lowerInput = messageText.toLowerCase();
      const response = await currentSession.sendMessage({ message: messageText });
      const botText = response.text;
      
      if (!botText) {
        throw new Error("A IA retornou uma resposta vazia.");
      }
        
        const botMessage: Message = {
          id: `bot_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          senderUid: 'bot',
          conversationId: currentConversationId || undefined,
          text: botText,
          createdAt: new Date()
        };

        if (currentConversationId) {
          setAllMessages(prev => ({
            ...prev,
            [currentConversationId]: [...(prev[currentConversationId] || []), botMessage]
          }));
        } else {
          setMessages(prev => [...prev, botMessage]);
        }

        // Logic for AGUARDANDO_PRECO
        if (botText.includes("Já verifiquei a melhor opção disponível para a sua viagem")) {
          const newQuote: Quote = {
            id: Date.now().toString(),
            clientUid: 'client',
            clientName: 'Cliente',
            details: messageText,
            destination: 'Verificar no chat',
            date: 'Verificar no chat',
            passengers: 1,
            status: 'pending',
            createdAt: new Date()
          };
          setQuotes(prev => [newQuote, ...prev]);
          
          // Detailed email for flight request
          const now = new Date().toLocaleString();
          notifyEmail(
            "Novo pedido de passagem - Aguardando preço", 
            `Novo pedido de cotação recebido via Chat.\n\n` +
            `- Cliente: Cliente\n` +
            `- Mensagem: ${messageText}\n` +
            `- Hora: ${now}\n` +
            `- Origem: Chat Web\n\n` +
            `O cliente entrou no estado AGUARDANDO_PRECO.`
          );
        }

        // Logic for Hotel Reservation
        if (botText.includes("A reserva de hotel tem o custo de 60 CVE por dia")) {
          const now = new Date().toLocaleString();
          notifyEmail(
            "Interesse em Reserva de Hotel",
            `Um cliente demonstrou interesse em reserva de hotel.\n\n` +
            `- Cliente: Cliente\n` +
            `- Mensagem: ${messageText}\n` +
            `- Hora: ${now}`
          );
        }

        // Logic for Ticket Reservation
        if (botText.includes("A reserva de passagem tem o custo de 1.000 CVE")) {
          const now = new Date().toLocaleString();
          notifyEmail(
            "Interesse em Reserva de Passagem",
            `Um cliente demonstrou interesse em reserva de passagem (bloqueio de vaga).\n\n` +
            `- Cliente: Cliente\n` +
            `- Mensagem: ${messageText}\n` +
            `- Hora: ${now}`
          );
        }

        // Logic for Appointment Request (Agendamento)
        const appointmentKeywords = ['quero agendar', 'quero marcar', 'preciso de agendamento', 'quero vaga', 'quero marcar entrevista', 'quero agendamento de férias', 'quero agendamento de contrato', 'quero agendamento de estudante'];
        if (appointmentKeywords.some(k => lowerInput.includes(k))) {
          const now = new Date().toLocaleString();
          notifyEmail(
            "Novo pedido de agendamento",
            `Um cliente demonstrou interesse em agendamento via Chat.\n\n` +
            `- Cliente: Cliente\n` +
            `- Mensagem: ${messageText}\n` +
            `- Hora: ${now}\n` +
            `- Origem: Chat Web`
          );
        }

        // Auto-send materials ONLY on explicit request or bot confirmation
        const requestKeywords = [
          'quais documentos', 'manda os documentos', 'lista de documentos', 'que docs', 
          'envia os documentos', 'quais os documentos', 'documentos necessários', 
          'dados bancários', 'como faço o pagamento', 'manda o iban', 'enviar iban', 
          'qual o iban', 'dados de pagamento', 'documentos visto', 'lista documentos visto', 'papéis para visto',
          'manda a conta', 'número da conta', 'numero da conta', 'dados para transferência', 'dados para transferencia',
          'manda os dados', 'quais os dados', 'enviar os dados', 'quero os dados', 'manda a lista', 'envia a lista', 'quero a lista',
          'manda o preçário', 'manda o precario', 'quais os valores', 'manda os valores'
        ];
        
        const isExplicitRequest = requestKeywords.some(k => lowerInput.includes(k));
        const isBotConfirming = [
          'enviar os dados bancários', 'enviar os dados bancarios', 'aqui estão os dados', 'aqui estao os dados',
          'envio os documentos', 'lista de documentos', 'segue o iban', 'aqui está o iban', 'aqui esta o iban',
          'dados para o pagamento', 'vou enviar a lista', 'vou mandar os documentos', 'aqui estão os detalhes',
          'aqui estao os detalhes', 'dados da conta',
          'segue o preçário', 'segue o precario', 'aqui estão os valores', 'aqui estao os valores'
        ].some(phrase => botText.toLowerCase().includes(phrase));

        if (isExplicitRequest || isBotConfirming) {
          materials.forEach(mat => {
            const categoryKeywords: Record<string, string[]> = {
              docs_ferias: ['férias', 'ferias', 'turismo'],
              docs_contrato: ['contrato', 'trabalho'],
              docs_estudante: ['visto', 'papéis para visto', 'papeis para visto'], 
              dados_bancarios: ['pagamento', 'pagar', 'iban', 'conta', 'nib', 'transferência', 'transferencia', 'dados', 'valores', 'preçário', 'precario']
            };
            
            const keywords = categoryKeywords[mat.category] || [];
            if (keywords.some(k => lowerInput.includes(k) || botText.toLowerCase().includes(k))) {
              // Special rule for docs_estudante: must be explicit about "visto"
              if (mat.category === 'docs_estudante' && !lowerInput.includes('visto') && !lowerInput.includes('papéis') && !lowerInput.includes('papeis') && !botText.toLowerCase().includes('visto')) {
                return;
              }
              sendMaterial(mat);
            }
          });
        }

        // Check for campaigns
        campaigns.forEach(cp => {
          if (cp.active && cp.keywords.some(k => lowerInput.includes(k.toLowerCase()))) {
            // The AI should already handle this via system instruction context
          }
        });
    } catch (error: any) {
      console.error("Erro no chat:", error);
      setChatSession(null); // Reset session on error to allow fresh start
      const errorMessage: Message = {
        id: `error_${Date.now()}`,
        senderUid: 'bot',
        conversationId: currentConversationId || undefined,
        text: `Desculpe, tive um problema técnico: ${error.message || 'Erro desconhecido'}. Por favor, tente novamente em instantes ou recarregue a página.`,
        createdAt: new Date()
      };
      
      if (currentConversationId) {
        setAllMessages(prev => ({
          ...prev,
          [currentConversationId]: [...(prev[currentConversationId] || []), errorMessage]
        }));
      } else {
        setMessages(prev => [...prev, errorMessage]);
      }
    } finally {
      setIsTyping(false);
    }
  };

  const sendMaterial = (material: Material) => {
    const matMessage: Message = {
      id: `mat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      senderUid: 'bot',
      conversationId: currentConversationId || undefined,
      fileUrl: material.fileUrl,
      fileType: material.fileType,
      fileName: material.fileName,
      isMaterial: true,
      createdAt: new Date()
    };

    if (currentConversationId) {
      setAllMessages(prev => ({
        ...prev,
        [currentConversationId]: [...(prev[currentConversationId] || []), matMessage]
      }));
    } else {
      setMessages(prev => [...prev, matMessage]);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const fileMessage: Message = {
        id: Date.now().toString(),
        senderUid: 'client',
        conversationId: currentConversationId || undefined,
        fileName: file.name,
        fileType: file.type,
        fileUrl: reader.result as string,
        createdAt: new Date()
      };
      
      if (currentConversationId) {
        setAllMessages(prev => ({
          ...prev,
          [currentConversationId]: [...(prev[currentConversationId] || []), fileMessage]
        }));
        setUserConversations(prev => prev.map(c => c.id === currentConversationId ? { ...c, lastMessage: `Enviou arquivo: ${file.name}`, updatedAt: new Date() } : c));
      } else {
        setMessages(prev => [...prev, fileMessage]);
      }
      const now = new Date().toLocaleString();
      notifyEmail(
        "Novo documento recebido", 
        `O cliente enviou um novo arquivo via Chat Web.\n\n` +
        `- Cliente: Cliente Web\n` +
        `- Arquivo: ${file.name}\n` +
        `- Tipo: ${file.type}\n` +
        `- Data/Hora: ${now}\n` +
        `- Origem: Chat Web`
      );

      // Update conversation for leads
      setConversations(prev => {
        const existing = prev.find(c => c.userId === 'client');
        if (existing) {
          return prev.map(c => c.userId === 'client' ? { ...c, lastMessage: `[Documento: ${file.name}]`, updatedAt: new Date() } : c);
        } else {
          return [{
            id: 'conv_client',
            userId: 'client',
            userName: 'Cliente Web',
            lastMessage: `[Documento: ${file.name}]`,
            updatedAt: new Date(),
            saleStatus: 'new'
          }, ...prev];
        }
      });
    };
    reader.readAsDataURL(file);
  };

  const handleUpdateQuote = (quoteId: string, price: string, observation: string, existingQuote?: Quote) => {
    setQuotes(prev => prev.map(q => q.id === quoteId ? { ...q, price, observation, status: 'quoted' } : q));
    
    // Use the provided quote or find it in the current state
    const quote = existingQuote || quotes.find(q => q.id === quoteId);
    
    if (quote) {
      const botMsg: Message = {
        id: Date.now().toString(),
        senderUid: 'bot',
        text: `Olá ${quote.clientName}, já tenho o valor da sua passagem para ${quote.destination}. O valor é ${price}. ${observation}`,
        createdAt: new Date()
      };
      setMessages(prev => [...prev, botMsg]);
      
      // Sync lead status
      setConversations(prev => prev.map(c => c.userId === quote.clientUid ? { ...c, saleStatus: 'negotiating' } : c));
    }
  };

  const handleManualQuote = (conversation: Conversation) => {
    setManualQuoteTarget(conversation);
    setShowManualQuoteModal(true);
  };

  return (
    <div className="min-h-screen bg-aventour-light flex flex-col font-sans text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 md:px-8 py-4 flex items-center justify-between sticky top-0 z-30 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-aventour-green rounded-xl flex items-center justify-center shadow-lg shadow-aventour-green/20">
            <Plane className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-aventour-green">Aventour</h1>
            <p className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">Assistente Comercial</p>
          </div>
        </div>

        {isAdmin && (
          <nav className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto no-scrollbar max-w-[70%] md:max-w-none">
            <button 
              onClick={() => setActiveTab('chat')}
              className={`px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-[10px] md:text-sm font-semibold transition-all whitespace-nowrap ${activeTab === 'chat' ? 'bg-white text-aventour-green shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Chat
            </button>
            <button 
              onClick={() => setActiveTab('campaigns')}
              className={`px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-[10px] md:text-sm font-semibold transition-all whitespace-nowrap ${activeTab === 'campaigns' ? 'bg-white text-aventour-green shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Campanhas
            </button>
            <button 
              onClick={() => setActiveTab('quotes')}
              className={`px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-[10px] md:text-sm font-semibold transition-all whitespace-nowrap ${activeTab === 'quotes' ? 'bg-white text-aventour-green shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Preços
            </button>
            <button 
              onClick={() => setActiveTab('documents')}
              className={`px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-[10px] md:text-sm font-semibold transition-all whitespace-nowrap ${activeTab === 'documents' ? 'bg-white text-aventour-green shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Documentos
            </button>
            <button 
              onClick={() => setActiveTab('sales')}
              className={`px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-[10px] md:text-sm font-semibold transition-all whitespace-nowrap ${activeTab === 'sales' ? 'bg-white text-aventour-green shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Vendas
            </button>
            <button 
              onClick={() => setActiveTab('materials')}
              className={`px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-[10px] md:text-sm font-semibold transition-all whitespace-nowrap ${activeTab === 'materials' ? 'bg-white text-aventour-green shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Materiais
            </button>
          </nav>
        )}

        <div className="flex items-center gap-2">
          {!isAdmin && (
            <button 
              onClick={() => setShowHistory(!showHistory)}
              className={`p-2 rounded-xl transition-all ${showHistory ? 'bg-aventour-green text-white' : 'text-slate-400 hover:text-aventour-green hover:bg-emerald-50'}`}
              title="Histórico de Conversas"
            >
              <MessageSquare size={20} />
            </button>
          )}
          {isAdmin && (
            <button 
              onClick={() => setIsAdmin(false)}
              className="p-2 text-slate-400 hover:text-red-500 transition-colors"
              title="Sair do Admin"
            >
              <LogOut size={20} />
            </button>
          )}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full border border-emerald-100">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
            <span className="text-[10px] font-bold text-emerald-700 uppercase">Online</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Client History Sidebar */}
        <AnimatePresence>
          {showHistory && !isAdmin && (
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              className="absolute inset-y-0 left-0 w-72 bg-white border-r border-slate-200 z-30 shadow-2xl flex flex-col"
            >
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare size={18} className="text-aventour-green" />
                  <h3 className="font-bold text-slate-800">Suas Conversas</h3>
                </div>
                <button onClick={() => setShowHistory(false)} className="p-2 text-slate-400 hover:text-slate-600">
                  <X size={20} />
                </button>
              </div>
              
              <div className="p-4">
                <button 
                  onClick={createNewConversation}
                  className="w-full py-3 bg-aventour-green text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-aventour-green-dark transition-all shadow-md"
                >
                  <Plus size={18} /> Nova Conversa
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {userConversations.map(conv => (
                  <div 
                    key={conv.id}
                    onClick={() => selectConversation(conv.id)}
                    className={`p-3 rounded-xl cursor-pointer transition-all group relative ${currentConversationId === conv.id ? 'bg-emerald-50 border border-emerald-100' : 'hover:bg-slate-50 border border-transparent'}`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <p className={`text-xs font-bold truncate pr-6 ${currentConversationId === conv.id ? 'text-aventour-green' : 'text-slate-700'}`}>
                        {conv.lastMessage || 'Nova conversa'}
                      </p>
                      <button 
                        onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                        className="absolute top-3 right-3 p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400">
                      {conv.updatedAt.toLocaleDateString()} {conv.updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {isAdmin && activeTab !== 'chat' ? (
          <div className="flex-1 overflow-y-auto p-4 md:p-8 max-w-7xl mx-auto w-full">
            {activeTab === 'campaigns' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-2xl font-bold">Gestão de Campanhas</h2>
                  <button 
                    onClick={() => {
                      setEditingCampaign(null);
                      setShowCampaignModal(true);
                    }}
                    className="bg-aventour-green text-white px-6 py-3 rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-aventour-green-dark transition-all shadow-lg shadow-aventour-green/20"
                  >
                    <Plus size={20} /> Nova Campanha
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  {campaigns.map(cp => (
                    <div key={cp.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-aventour-green/30 transition-colors">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-bold text-lg text-slate-800">{cp.title}</h3>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${cp.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                            {cp.active ? 'Ativa' : 'Inativa'}
                          </span>
                        </div>
                        <p className="text-sm text-slate-600 mb-3 leading-relaxed">{cp.context}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {cp.keywords.map((k, i) => (
                            <span key={i} className="px-2.5 py-1 bg-slate-100 text-slate-500 rounded-lg text-[10px] font-bold border border-slate-200">
                              #{k}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => {
                            setEditingCampaign(cp);
                            setShowCampaignModal(true);
                          }}
                          className="p-3 text-slate-400 hover:text-aventour-green hover:bg-emerald-50 rounded-xl transition-all"
                          title="Editar"
                        >
                          <Settings size={20} />
                        </button>
                        <button 
                          onClick={() => setCampaigns(prev => prev.map(c => c.id === cp.id ? { ...c, active: !c.active } : c))}
                          className={`p-3 rounded-xl transition-all ${cp.active ? 'text-amber-500 hover:bg-amber-50' : 'text-emerald-500 hover:bg-emerald-50'}`}
                          title={cp.active ? "Desativar" : "Ativar"}
                        >
                          {cp.active ? <X size={20} /> : <CheckCircle size={20} />}
                        </button>
                        <button 
                          onClick={() => {
                            if(confirm("Tem certeza que deseja excluir esta campanha?")) {
                              setCampaigns(prev => prev.filter(c => c.id !== cp.id));
                            }
                          }}
                          className="p-3 text-red-400 hover:bg-red-50 rounded-xl transition-all"
                          title="Excluir"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'quotes' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-2xl font-bold">Preço da Passagem</h2>
                  <button 
                    onClick={() => {
                      setManualQuoteTarget(null);
                      setShowManualQuoteModal(true);
                    }}
                    className="bg-aventour-green text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg shadow-aventour-green/20 hover:scale-105 transition-transform"
                  >
                    <Plus size={18} /> Novo Pedido
                  </button>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Cliente</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Solicitação</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {quotes.map(q => (
                        <tr key={q.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4">
                            <p className="font-bold text-slate-900">{q.clientName}</p>
                            <p className="text-[10px] text-slate-400 flex items-center gap-1 mt-1">
                              <Clock size={10} /> {q.createdAt.toLocaleTimeString()}
                            </p>
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm text-slate-600 line-clamp-1">{q.details}</p>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${q.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                              {q.status === 'pending' ? 'Aguardando Preço' : 'Cotado'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            {q.status === 'pending' ? (
                              <button 
                                onClick={() => {
                                  setSelectedQuoteForUpdate(q);
                                  setShowQuoteUpdateModal(true);
                                }}
                                className="text-aventour-green hover:text-aventour-green-dark font-bold text-sm flex items-center gap-1"
                              >
                                <DollarSign size={16} /> Inserir Preço
                              </button>
                            ) : (
                              <span className="text-slate-400 text-sm font-medium">{q.price}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {quotes.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center text-slate-400">
                            Nenhum pedido de cotação pendente.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'documents' && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold">Documentos Recebidos</h2>
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Cliente</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Documento</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Data</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Ação</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {messages.filter(m => m.fileUrl && m.senderUid === 'client').map(m => (
                        <tr key={m.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4">
                            <p className="font-bold text-slate-900">Cliente Web</p>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <FileText size={16} className="text-aventour-green" />
                              <p className="text-sm text-slate-600 truncate max-w-[200px]">{m.fileName}</p>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-500">
                            {m.createdAt.toLocaleString()}
                          </td>
                          <td className="px-6 py-4">
                            <button 
                              onClick={() => setPreviewFile({ url: m.fileUrl!, name: m.fileName!, type: m.fileType! })}
                              className="text-aventour-green hover:underline font-bold text-sm"
                            >
                              Visualizar
                            </button>
                          </td>
                        </tr>
                      ))}
                      {messages.filter(m => m.fileUrl && m.senderUid === 'client').length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-6 py-12 text-center text-slate-400">
                            Nenhum documento recebido ainda.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'sales' && (
              <div className="space-y-8">
                <div className="flex justify-between items-center">
                  <h2 className="text-2xl font-bold">Vendas e Leads</h2>
                  <div className="flex gap-4">
                    <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex items-center gap-2">
                      <TrendingUp size={18} className="text-aventour-green" />
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase font-bold">Total Vendas</p>
                        <p className="text-sm font-bold">{sales.reduce((acc, s) => acc + s.value, 0).toLocaleString()} CVE</p>
                      </div>
                    </div>
                    <div className="bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm flex items-center gap-2">
                      <Users size={18} className="text-blue-500" />
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase font-bold">Leads Ativos</p>
                        <p className="text-sm font-bold">{conversations.filter(c => c.saleStatus !== 'closed' && c.saleStatus !== 'lost').length}</p>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Leads Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <Users size={20} className="text-aventour-green" /> Leads Ativos
                  </h3>
                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Cliente</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Última Mensagem</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {conversations.filter(c => c.saleStatus !== 'closed' && c.saleStatus !== 'lost').map(c => (
                          <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-6 py-4 font-bold text-slate-900">{c.userName}</td>
                            <td className="px-6 py-4 text-sm text-slate-600 line-clamp-1">{c.lastMessage}</td>
                            <td className="px-6 py-4">
                              <select 
                                value={c.saleStatus}
                                onChange={(e) => {
                                  const newStatus = e.target.value as any;
                                  setConversations(prev => prev.map(conv => conv.id === c.id ? { ...conv, saleStatus: newStatus } : conv));
                                  if (newStatus === 'closed') {
                                    setSaleTarget(c);
                                    setShowSaleModal(true);
                                  }
                                }}
                                className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-slate-50 font-bold uppercase"
                              >
                                <option value="new">Novo Lead</option>
                                <option value="attending">Em Atendimento</option>
                                <option value="waiting_price">Aguardando Preço</option>
                                <option value="negotiating">Em Negociação</option>
                                <option value="closed">Fechado</option>
                                <option value="lost">Perdido</option>
                              </select>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex flex-col gap-2">
                                <button 
                                  onClick={() => {
                                    setSelectedConversation(c);
                                    setActiveTab('chat');
                                  }}
                                  className="text-aventour-green hover:underline text-sm font-bold text-left"
                                >
                                  Abrir Chat
                                </button>
                                {c.saleStatus === 'waiting_price' ? (
                                  <button 
                                    onClick={() => {
                                      const quote = quotes.find(q => q.clientUid === c.userId && q.status === 'pending');
                                      if (quote) {
                                        setSelectedQuoteForUpdate(quote);
                                        setShowQuoteUpdateModal(true);
                                      } else {
                                        // If no quote exists, open manual quote modal for this client
                                        setManualQuoteTarget(c);
                                        setShowManualQuoteModal(true);
                                      }
                                    }}
                                    className="text-blue-500 hover:underline text-sm font-bold text-left flex items-center gap-1"
                                  >
                                    <DollarSign size={14} /> Inserir Preço
                                  </button>
                                ) : (
                                  <button 
                                    onClick={() => handleManualQuote(c)}
                                    className="text-slate-400 hover:text-slate-600 hover:underline text-[10px] font-bold text-left"
                                  >
                                    Pedir Cotação
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                        {conversations.filter(c => c.saleStatus !== 'closed' && c.saleStatus !== 'lost').length === 0 && (
                          <tr>
                            <td colSpan={4} className="px-6 py-12 text-center text-slate-400">
                              Nenhum lead ativo no momento.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Sales History Section */}
                <div className="space-y-4">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <CheckCircle size={20} className="text-emerald-500" /> Histórico de Vendas
                  </h3>
                  <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                    <table className="w-full text-left border-collapse">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Cliente</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Serviço</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Valor</th>
                          <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Data</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {sales.map(s => (
                          <tr key={s.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-6 py-4 font-bold text-slate-900">{s.clientName}</td>
                            <td className="px-6 py-4 text-sm text-slate-600">{s.service}</td>
                            <td className="px-6 py-4 text-sm font-bold text-aventour-green">{s.value.toLocaleString()} CVE</td>
                            <td className="px-6 py-4 text-sm text-slate-500">{s.createdAt.toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'materials' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-2xl font-bold">Biblioteca de Materiais</h2>
                  <div className="flex gap-2">
                    <input 
                      type="file" 
                      id="new-material-upload" 
                      className="hidden" 
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = () => {
                            setNewMaterialFile({ file, url: reader.result as string });
                            setShowMaterialModal(true);
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                    <button 
                      onClick={() => document.getElementById('new-material-upload')?.click()}
                      className="bg-aventour-green text-white px-6 py-3 rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-aventour-green-dark transition-all shadow-lg shadow-aventour-green/20"
                    >
                      <Plus size={20} /> Novo Material
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {materials.map(mat => (
                    <div key={mat.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm group hover:border-aventour-green/30 transition-all">
                      <div className="aspect-video bg-slate-100 rounded-xl mb-4 overflow-hidden relative">
                        <img src={mat.fileUrl} alt={mat.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity gap-2">
                          <button 
                            onClick={() => setPreviewFile({ url: mat.fileUrl, name: mat.fileName, type: mat.fileType })}
                            className="p-3 bg-white rounded-full text-aventour-green hover:scale-110 transition-transform shadow-lg"
                            title="Visualizar"
                          >
                            <Eye size={20} />
                          </button>
                          <button 
                            onClick={() => {
                              const input = document.createElement('input');
                              input.type = 'file';
                              input.accept = 'image/*';
                              input.onchange = (e: any) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  const reader = new FileReader();
                                  reader.onload = () => {
                                    setMaterials(prev => prev.map(m => m.id === mat.id ? { 
                                      ...m, 
                                      fileUrl: reader.result as string, 
                                      fileName: file.name, 
                                      fileType: file.type 
                                    } : m));
                                  };
                                  reader.readAsDataURL(file);
                                }
                              };
                              input.click();
                            }}
                            className="p-3 bg-white rounded-full text-blue-500 hover:scale-110 transition-transform shadow-lg"
                            title="Substituir Imagem"
                          >
                            <FileUp size={20} />
                          </button>
                        </div>
                      </div>
                      <div className="flex justify-between items-start mb-1">
                        <h3 className="font-bold text-lg text-slate-800">{mat.title}</h3>
                        <button 
                          onClick={() => {
                            setEditingMaterial(mat);
                            setShowMaterialModal(true);
                          }}
                          className="p-2 text-slate-400 hover:text-aventour-green hover:bg-slate-50 rounded-lg transition-colors"
                        >
                          <Settings size={16} />
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-400 uppercase font-bold mb-4 tracking-wider">{mat.category.replace('_', ' ')}</p>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => sendMaterial(mat)}
                          className="flex-1 py-2.5 bg-aventour-green text-white rounded-xl text-xs font-bold hover:bg-aventour-green-dark transition-colors shadow-sm"
                        >
                          Enviar no Chat
                        </button>
                        <button 
                          onClick={() => {
                            if(confirm("Excluir este material?")) {
                              setMaterials(prev => prev.filter(m => m.id !== mat.id));
                            }
                          }}
                          className="p-2.5 text-red-400 hover:bg-red-50 rounded-xl transition-colors"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Chat View (Client or Admin Chat Tab) */
          <div className="flex-1 flex flex-col overflow-hidden bg-white">
            {/* Messages Area */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-8 space-y-2 scrollbar-thin">
              <div className="max-w-4xl mx-auto w-full">
                {apiError && (
                  <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-800 text-sm">
                    <div className="flex items-center gap-2 mb-2 font-bold">
                      <Shield size={18} className="text-amber-500" />
                      Atenção: Configuração Necessária
                    </div>
                    <p className="mb-3">O chat está desativado porque a chave da API Gemini é inválida ou não foi configurada.</p>
                    <div className="space-y-1 text-xs">
                      <p>1. Vá em **Settings** &gt; **Secrets** no menu do AI Studio.</p>
                      <p>2. Adicione a chave `GEMINI_API_KEY` com um valor válido.</p>
                      <p>3. Recarregue esta página.</p>
                    </div>
                    <a 
                      href="https://aistudio.google.com/app/apikey" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="inline-block mt-3 text-aventour-green font-bold hover:underline"
                    >
                      Obter chave gratuita aqui &rarr;
                    </a>
                  </div>
                )}
                {messages.map((msg) => <MessageBubble key={msg.id} msg={msg} onPreview={setPreviewFile} />)}
                {isTyping && (
                  <div className="flex justify-start mb-4">
                    <div className="bg-white border border-slate-100 rounded-2xl rounded-tl-none px-4 py-3 flex gap-1 shadow-sm">
                      <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce"></span>
                      <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                      <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Chips & Input */}
            <div className="border-t border-slate-100 bg-white p-4 md:p-6">
              <div className="max-w-4xl mx-auto w-full space-y-4">
                {!isAdmin && (
                  <div className="flex flex-wrap gap-2 pb-2 overflow-x-auto no-scrollbar">
                    {['Passagens', 'Agendamento Férias', 'Formações', 'Outras Ilhas'].map(chip => (
                      <button 
                        key={chip}
                        onClick={() => sendMessage(chip)}
                        className="px-4 py-2 bg-slate-100 hover:bg-aventour-green hover:text-white text-slate-600 rounded-full text-xs font-bold transition-all whitespace-nowrap border border-slate-200"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                )}

                <form 
                  onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
                  className="flex items-end gap-2 md:gap-4"
                >
                  <div className="flex-1 bg-slate-50 rounded-2xl border border-slate-200 p-2 flex items-end shadow-inner">
                    <button 
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="p-2.5 text-slate-400 hover:text-aventour-green transition-colors"
                    >
                      <Paperclip size={22} />
                    </button>
                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      className="hidden" 
                      onChange={handleFileUpload} 
                    />
                    <textarea
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendMessage();
                        }
                      }}
                      placeholder="Escreva sua mensagem..."
                      rows={1}
                      className="flex-1 bg-transparent border-none focus:ring-0 resize-none py-2.5 px-2 text-slate-700 max-h-32 text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!inputText.trim() || isTyping}
                    className="bg-aventour-green text-white p-4 rounded-2xl hover:bg-aventour-green-dark disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-aventour-green/20 transition-all active:scale-95"
                  >
                    <Send size={22} />
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-100 px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-[10px] text-slate-400 font-medium">
          <MapPin size={12} className="text-aventour-green" />
          <span>Achada São Filipe, Praia (ao lado da loja Calú e Angela)</span>
        </div>
        
        <div className="flex items-center gap-4">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
            Aventour © 2026 - Todos os direitos reservados
          </p>
          <button 
            onClick={() => setShowAdminLogin(true)}
            className="p-1.5 text-slate-300 hover:text-aventour-green transition-colors"
          >
            <Lock size={14} />
          </button>
        </div>
      </footer>

      {/* Admin Login Modal */}
      <AnimatePresence>
        {showAdminLogin && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-3xl p-8 w-full max-w-sm shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold">Acesso Restrito</h3>
                <button onClick={() => setShowAdminLogin(false)} className="text-slate-400 hover:text-slate-600">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleAdminLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Código de Acesso</label>
                  <input 
                    type="password" 
                    value={adminCodeInput}
                    onChange={(e) => {
                      setAdminCodeInput(e.target.value);
                      setLoginError(false);
                    }}
                    autoFocus
                    className={`w-full bg-slate-50 border ${loginError ? 'border-red-500' : 'border-slate-200'} rounded-xl px-4 py-3 focus:ring-2 focus:ring-aventour-green outline-none transition-all`}
                    placeholder="••••••••"
                  />
                  {loginError && <p className="text-red-500 text-[10px] font-bold mt-1 uppercase tracking-wider">Código incorreto. Tente novamente.</p>}
                </div>
                <button 
                  type="submit"
                  className="w-full py-3 bg-aventour-green text-white rounded-xl font-bold hover:bg-aventour-green-dark transition-all shadow-lg shadow-aventour-green/20"
                >
                  Entrar no Painel
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <Modal 
        title={editingCampaign ? "Editar Campanha" : "Nova Campanha"} 
        isOpen={showCampaignModal} 
        onClose={() => setShowCampaignModal(false)}
      >
        <form onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          const title = formData.get('title') as string;
          const keywords = (formData.get('keywords') as string).split(',').map(k => k.trim());
          const context = formData.get('context') as string;
          
          if (editingCampaign) {
            setCampaigns(prev => prev.map(c => c.id === editingCampaign.id ? { ...c, title, keywords, context } : c));
          } else {
            const newCp: Campaign = {
              id: Date.now().toString(),
              title,
              description: '',
              keywords,
              context,
              serviceType: 'Geral',
              active: true,
              createdAt: new Date()
            };
            setCampaigns(prev => [newCp, ...prev]);
          }
          setShowCampaignModal(false);
        }} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome da Campanha</label>
            <input name="title" defaultValue={editingCampaign?.title} required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-aventour-green/20 focus:border-aventour-green outline-none transition-all" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Palavras-chave (separadas por vírgula)</label>
            <input name="keywords" defaultValue={editingCampaign?.keywords.join(', ')} required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-aventour-green/20 focus:border-aventour-green outline-none transition-all" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Resposta do Assistente</label>
            <textarea name="context" defaultValue={editingCampaign?.context} required rows={4} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-aventour-green/20 focus:border-aventour-green outline-none transition-all resize-none" />
          </div>
          <button type="submit" className="w-full py-4 bg-aventour-green text-white rounded-2xl font-bold hover:bg-aventour-green-dark transition-all shadow-lg shadow-aventour-green/20">
            {editingCampaign ? "Salvar Alterações" : "Criar Campanha"}
          </button>
        </form>
      </Modal>

      <Modal 
        title={editingMaterial ? "Editar Material" : "Novo Material"} 
        isOpen={showMaterialModal} 
        onClose={() => {
          setShowMaterialModal(false);
          setEditingMaterial(null);
          setNewMaterialFile(null);
        }}
      >
        <form onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          const title = formData.get('title') as string;
          const category = formData.get('category') as any;
          
          if (editingMaterial) {
            setMaterials(prev => prev.map(m => m.id === editingMaterial.id ? { ...m, title, category } : m));
            setShowMaterialModal(false);
            setEditingMaterial(null);
          } else if (newMaterialFile) {
            const newMat: Material = {
              id: Date.now().toString(),
              title,
              category,
              fileName: newMaterialFile.file.name,
              fileType: newMaterialFile.file.type,
              fileUrl: newMaterialFile.url,
              createdAt: new Date()
            };
            setMaterials(prev => [...prev, newMat]);
            setNewMaterialFile(null);
            setShowMaterialModal(false);
          }
        }} className="space-y-4">
          {(newMaterialFile || editingMaterial) && (
            <div className="aspect-video rounded-xl overflow-hidden border border-slate-200 mb-4">
              <img src={newMaterialFile?.url || editingMaterial?.fileUrl} alt="Preview" className="w-full h-full object-cover" />
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Título do Material</label>
            <input name="title" defaultValue={editingMaterial?.title} required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-aventour-green/20 focus:border-aventour-green outline-none transition-all" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Categoria</label>
            <select name="category" defaultValue={editingMaterial?.category} required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-aventour-green/20 focus:border-aventour-green outline-none transition-all">
              <option value="docs_ferias">Docs Férias</option>
              <option value="docs_contrato">Docs Contrato</option>
              <option value="docs_estudante">Docs Estudante</option>
              <option value="dados_bancarios">Dados Bancários</option>
            </select>
          </div>
          <button type="submit" className="w-full py-4 bg-aventour-green text-white rounded-2xl font-bold hover:bg-aventour-green-dark transition-all shadow-lg shadow-aventour-green/20">
            {editingMaterial ? "Salvar Alterações" : "Salvar Material"}
          </button>
        </form>
      </Modal>

      {/* Quote Update Modal */}
      <Modal 
        title="Inserir Preço da Passagem" 
        isOpen={showQuoteUpdateModal} 
        onClose={() => setShowQuoteUpdateModal(false)}
      >
        <form onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget as HTMLFormElement);
          const price = formData.get('price') as string;
          const obs = formData.get('observation') as string;
          if (selectedQuoteForUpdate && price) {
            handleUpdateQuote(selectedQuoteForUpdate.id, price, obs);
            setShowQuoteUpdateModal(false);
            setSelectedQuoteForUpdate(null);
          }
        }} className="space-y-4">
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 mb-4">
            <p className="text-xs font-bold text-slate-400 uppercase mb-1">Cliente</p>
            <p className="font-bold text-slate-800">{selectedQuoteForUpdate?.clientName}</p>
            <p className="text-xs text-slate-500 mt-2">Destino: {selectedQuoteForUpdate?.destination}</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Valor da Passagem (CVE)</label>
            <input 
              name="price" 
              type="text" 
              required 
              placeholder="Ex: 45.000"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-aventour-green/20 focus:border-aventour-green outline-none transition-all" 
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Observação (opcional)</label>
            <textarea 
              name="observation" 
              rows={3} 
              placeholder="Ex: Inclui bagagem de 23kg..."
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-aventour-green/20 focus:border-aventour-green outline-none transition-all resize-none" 
            />
          </div>
          <button type="submit" className="w-full py-4 bg-aventour-green text-white rounded-2xl font-bold hover:bg-aventour-green-dark transition-all shadow-lg shadow-aventour-green/20">
            Enviar Preço ao Cliente
          </button>
        </form>
      </Modal>

      {/* Manual Quote Modal */}
      <Modal 
        title="Novo Pedido de Cotação" 
        isOpen={showManualQuoteModal} 
        onClose={() => setShowManualQuoteModal(false)}
      >
        <form onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget as HTMLFormElement);
          const clientName = manualQuoteTarget ? manualQuoteTarget.userName : (formData.get('clientName') as string);
          const destination = formData.get('destination') as string;
          const details = formData.get('details') as string;
          
          if (clientName && destination) {
            const newQuote: Quote = {
              id: Date.now().toString(),
              clientUid: manualQuoteTarget ? manualQuoteTarget.userId : 'manual_' + Date.now(),
              clientName,
              details: details || "Solicitado manualmente pelo admin",
              destination,
              date: "A definir",
              passengers: 1,
              status: 'pending',
              createdAt: new Date()
            };
            
            setQuotes(prev => [newQuote, ...prev]);
            
            if (manualQuoteTarget) {
              setConversations(prev => prev.map(c => c.id === manualQuoteTarget.id ? { ...c, saleStatus: 'waiting_price' } : c));
            }
            
            setShowManualQuoteModal(false);
            setManualQuoteTarget(null);
          }
        }} className="space-y-4">
          {!manualQuoteTarget && (
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome do Cliente</label>
              <input name="clientName" required className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-aventour-green/20 focus:border-aventour-green outline-none transition-all" />
            </div>
          )}
          {manualQuoteTarget && (
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 mb-4">
              <p className="text-xs font-bold text-slate-400 uppercase mb-1">Cliente Selecionado</p>
              <p className="font-bold text-slate-800">{manualQuoteTarget.userName}</p>
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Destino</label>
            <input name="destination" required placeholder="Ex: Lisboa, Portugal" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-aventour-green/20 focus:border-aventour-green outline-none transition-all" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Detalhes Adicionais (opcional)</label>
            <textarea name="details" rows={2} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-aventour-green/20 focus:border-aventour-green outline-none transition-all resize-none" />
          </div>
          <button type="submit" className="w-full py-4 bg-aventour-green text-white rounded-2xl font-bold hover:bg-aventour-green-dark transition-all shadow-lg shadow-aventour-green/20">
            Criar Pedido de Cotação
          </button>
        </form>
      </Modal>

      {/* Sale Modal */}
      <Modal 
        title="Registrar Venda" 
        isOpen={showSaleModal} 
        onClose={() => setShowSaleModal(false)}
      >
        <form onSubmit={(e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget as HTMLFormElement);
          const value = formData.get('value') as string;
          const service = formData.get('service') as string;
          
          if (saleTarget && value && service) {
            const newSale: Sale = {
              id: Date.now().toString(),
              clientUid: saleTarget.userId,
              clientName: saleTarget.userName,
              service,
              value: parseInt(value),
              createdAt: new Date()
            };
            
            setSales(prev => [newSale, ...prev]);
            
            const now = new Date().toLocaleString();
            notifyEmail(
              "Venda fechada com sucesso", 
              `Uma nova venda foi registrada no painel admin.\n\n` +
              `- Cliente: ${saleTarget.userName}\n` +
              `- Serviço: ${service}\n` +
              `- Valor: ${value} CVE\n` +
              `- Data/Hora: ${now}`
            );
            
            setShowSaleModal(false);
            setSaleTarget(null);
          }
        }} className="space-y-4">
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 mb-4">
            <p className="text-xs font-bold text-slate-400 uppercase mb-1">Cliente</p>
            <p className="font-bold text-slate-800">{saleTarget?.userName}</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Serviço Vendido</label>
            <input name="service" required placeholder="Ex: Passagem Lisboa-Praia" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-aventour-green/20 focus:border-aventour-green outline-none transition-all" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Valor da Venda (CVE)</label>
            <input name="value" type="number" required placeholder="Ex: 45000" className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-aventour-green/20 focus:border-aventour-green outline-none transition-all" />
          </div>
          <button type="submit" className="w-full py-4 bg-aventour-green text-white rounded-2xl font-bold hover:bg-aventour-green-dark transition-all shadow-lg shadow-aventour-green/20">
            Confirmar Venda
          </button>
        </form>
      </Modal>

      {/* File Preview Modal */}
      <AnimatePresence>
        {previewFile && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 md:p-10"
          >
            <button 
              onClick={() => setPreviewFile(null)}
              className="absolute top-6 right-6 text-white/70 hover:text-white p-2 z-50"
            >
              <X size={32} />
            </button>
            <div className="max-w-5xl w-full h-full flex items-center justify-center relative">
              {previewFile.type.startsWith('image/') ? (
                <img 
                  src={previewFile.url} 
                  alt="Preview" 
                  className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" 
                />
              ) : (
                <div className="bg-white rounded-3xl p-10 text-center max-w-md">
                  <FileText size={64} className="text-aventour-green mx-auto mb-6" />
                  <h3 className="text-xl font-bold text-slate-900 mb-2">{previewFile.name}</h3>
                  <p className="text-slate-500 mb-8">Este arquivo não pode ser visualizado diretamente no navegador.</p>
                  <a 
                    href={previewFile.url} 
                    download={previewFile.name}
                    className="inline-flex items-center gap-2 bg-aventour-green text-white px-8 py-3 rounded-xl font-bold hover:bg-aventour-green-dark transition-all"
                  >
                    <Download size={20} />
                    Baixar Arquivo
                  </a>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;
