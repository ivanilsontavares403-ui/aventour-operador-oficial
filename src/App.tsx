import { useState, useEffect, useRef, useMemo, type FC, type ReactNode, type FormEvent, type ChangeEvent } from 'react';
import {
  Send,
  Paperclip,
  LogOut,
  FileText,
  X,
  MessageSquare,
  Download,
  Plane,
  Folder,
  Users,
  Plus,
  Trash2,
  Eye,
  Lock,
  DollarSign,
  RefreshCw,
  MapPin,
  Tag,
  Edit3,
  AlertCircle,
  Mail,
  Phone,
  Bot,
  User as UserIcon,
  CheckCircle2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Message {
  id: string;
  senderUid: 'bot' | 'client';
  text?: string;
  fileUrl?: string;
  fileType?: string;
  fileName?: string;
  isMaterial?: boolean;
  createdAt: Date;
  conversationId?: string;
}

interface Material {
  id: string;
  title: string;
  category: 'docs_ferias' | 'docs_contrato' | 'docs_estudante' | 'dados_bancarios';
  fileUrl: string;
  fileType: string;
  fileName: string;
  createdAt: Date;
}

interface Campaign {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  context: string;
  discount?: string;
  price?: number;
  active: boolean;
  createdAt: Date;
}

interface Quote {
  id: string;
  clientId: string;
  clientName: string;
  destination: string;
  details: string;
  price?: string;
  observation?: string;
  status: 'pending' | 'quoted' | 'accepted' | 'rejected';
  createdAt: Date;
  updatedAt: Date;
}

interface ClientSession {
  senderId: string;
  service: string;
  step: string;
  data: Record<string, string>;
  updatedAt: string;
  quoteId?: string;
  lastIntent?: string;
}

interface SessionApiResponse {
  senderId?: string;
  service?: string;
  step?: string;
  data?: Record<string, string>;
  updatedAt?: string;
  quoteId?: string;
  lastIntent?: string;
}

const ADMIN_CODE = 'Aventour@2025';
const COMPANY_PHONE = '+238 913 23 75';

const INITIAL_MESSAGES: Message[] = [
  {
    id: '1',
    senderUid: 'bot',
    text: 'Olá! Sou Consultor Comercial da Aventour Viagens e Turismo. Como posso ajudar com a sua viagem hoje?',
    createdAt: new Date(),
  },
];

const EMPTY_SESSION = (senderId = ''): ClientSession => ({
  senderId,
  service: 'none',
  step: '',
  data: {},
  updatedAt: new Date(0).toISOString(),
});

const SERVICE_LABELS: Record<string, string> = {
  none: 'Menu',
  formacao: 'Formação',
  ferias: 'Férias',
  agendamento_consular: 'Agendamento',
  passagem: 'Passagens',
  reserva_hotel: 'Hotel',
  reserva_passagem: 'Reserva de passagem',
};

const STEP_LABELS: Record<string, string> = {
  '': 'Início',
  inicio: 'Início',
  formacao_idade: 'Idade',
  formacao_escolaridade: 'Escolaridade',
  formacao_curso: 'Curso',
  formacao_confirmacao: 'Confirmação',
  passagem_destino: 'Destino',
  passagem_data: 'Data',
  passagem_pessoas: 'Pessoas',
  passagem_aguardando_preco: 'Aguardando cotação',
  passagem_cotacao_enviada: 'Cotação enviada',
  ferias_tipo_pessoa: 'Para quem',
  ferias_email: 'Email',
  ferias_telefone: 'Telefone',
  ferias_trabalho: 'Trabalho',
  ferias_morada: 'Morada',
  agendamento_tipo: 'Tipo',
  agendamento_disponibilidade: 'Disponibilidade',
  hotel_datas: 'Datas',
  hotel_local: 'Destino/Hotel',
  reserva_passagem_finalizada: 'Finalizado',
};

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

const isValidEmail = (text: string) => /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text);
const isValidPhone = (text: string) => /^\+?\d{7,15}$/.test(text.replace(/[^\d+]/g, ''));

function parseJsonSafe<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function sanitizeSession(senderId: string, input: SessionApiResponse | null | undefined): ClientSession {
  return {
    senderId: typeof input?.senderId === 'string' && input.senderId ? input.senderId : senderId,
    service: typeof input?.service === 'string' ? input.service : 'none',
    step: typeof input?.step === 'string' ? input.step : '',
    data: input?.data && typeof input.data === 'object' ? input.data : {},
    updatedAt: typeof input?.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
    quoteId: typeof input?.quoteId === 'string' ? input.quoteId : undefined,
    lastIntent: typeof input?.lastIntent === 'string' ? input.lastIntent : undefined,
  };
}

if (typeof window !== 'undefined') {
  console.assert(normalize(' Férias ') === 'ferias', 'normalize should remove accents and trim');
  console.assert(isValidEmail('nome@gmail.com') === true, 'valid email should pass');
  console.assert(isValidEmail('nomegmail.com') === false, 'invalid email should fail');
  console.assert(isValidPhone('+2389123456') === true, 'valid phone should pass');
  console.assert(isValidPhone('abc') === false, 'invalid phone should fail');
  console.assert(sanitizeSession('abc', null).senderId === 'abc', 'sanitizeSession should preserve senderId fallback');
}

const Modal: FC<{
  title: string;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}> = ({ title, isOpen, onClose, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/60">
          <h3 className="font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <X size={20} className="text-slate-500" />
          </button>
        </div>
        <div className="p-6 max-h-[80vh] overflow-y-auto">{children}</div>
      </motion.div>
    </div>
  );
};

const MessageBubble: FC<{
  msg: Message;
  onPreview: (file: { url: string; name: string; type: string }) => void;
}> = ({ msg, onPreview }) => {
  const isBot = msg.senderUid === 'bot';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className={`flex ${isBot ? 'justify-start' : 'justify-end'} mb-4`}
    >
      <div className="flex items-end gap-2 max-w-[88%] md:max-w-[72%]">
        {isBot && (
          <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 mb-1">
            <Bot size={16} />
          </div>
        )}
        {!isBot && (
          <div className="order-2 w-8 h-8 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center shrink-0 mb-1">
            <UserIcon size={16} />
          </div>
        )}

        <div
          className={`rounded-2xl px-4 py-3 shadow-sm ${
            isBot
              ? 'bg-white text-slate-800 border border-slate-100 rounded-tl-none'
              : 'bg-emerald-600 text-white rounded-tr-none'
          }`}
        >
          {msg.text && <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>}

          {msg.fileUrl && (
            <div className="mt-3">
              {msg.fileType?.startsWith('image/') ? (
                <img
                  src={msg.fileUrl}
                  alt="Preview"
                  className="rounded-xl max-h-60 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => onPreview({ url: msg.fileUrl!, name: msg.fileName!, type: msg.fileType! })}
                />
              ) : (
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <FileText size={20} className="text-emerald-600" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-900 truncate">{msg.fileName}</p>
                    <p className="text-[10px] text-slate-400 uppercase">{msg.fileType?.split('/')[1]}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => window.open(msg.fileUrl, '_blank')}
                    className="p-2 text-slate-400 hover:text-emerald-600 transition-colors"
                  >
                    <Download size={18} />
                  </button>
                </div>
              )}
            </div>
          )}

          <p className={`text-[10px] mt-1 opacity-60 ${isBot ? 'text-left' : 'text-right'}`}>
            {msg.createdAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      </div>
    </motion.div>
  );
};

const App: FC = () => {
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminCodeInput, setAdminCodeInput] = useState('');
  const [loginError, setLoginError] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'leads' | 'quotes' | 'materials' | 'campaigns'>('chat');

  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string>(`web_${Date.now()}`);
  const [showHistory, setShowHistory] = useState(false);
  const [userConversations, setUserConversations] = useState<Array<{ id: string; lastMessage: string; updatedAt: Date }>>([]);

  const [materials, setMaterials] = useState<Material[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [activeSessions, setActiveSessions] = useState<ClientSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ClientSession>(EMPTY_SESSION(currentConversationId));
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string; type: string } | null>(null);
  const [inputHint, setInputHint] = useState<string | null>(null);

  const [showMaterialModal, setShowMaterialModal] = useState(false);
  const [showCampaignModal, setShowCampaignModal] = useState(false);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [newMaterialFile, setNewMaterialFile] = useState<{ file: File; url: string } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadMaterials();
    loadCampaigns();
    loadQuotes();
    if (isAdmin) void loadActiveSessions();

    const saved = localStorage.getItem('aventour_conversations');
    if (saved) {
      const parsed = parseJsonSafe<Array<{ id: string; lastMessage: string; updatedAt: string }>>(saved, []).map((c) => ({
        ...c,
        updatedAt: new Date(c.updatedAt),
      }));
      setUserConversations(parsed);
    }
  }, [isAdmin]);

  useEffect(() => {
    localStorage.setItem('aventour_conversations', JSON.stringify(userConversations));
  }, [userConversations]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isTyping]);

  useEffect(() => {
    if (currentConversationId) {
      setCurrentSession(EMPTY_SESSION(currentConversationId));
      void loadSession(currentConversationId);
    }
  }, [currentConversationId]);

  useEffect(() => {
    if (currentConversationId && messages.length > 0) {
      localStorage.setItem(`messages_${currentConversationId}`, JSON.stringify(messages));
    }
  }, [messages, currentConversationId]);

  const loadMaterials = async () => {
    try {
      const res = await fetch('/api/materials');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMaterials(data.map((m: any) => ({ ...m, createdAt: new Date(m.createdAt) })));
    } catch (e) {
      console.error('Erro loading materials:', e);
    }
  };

  const loadCampaigns = async () => {
    try {
      const res = await fetch('/api/campaigns');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCampaigns(data.map((c: any) => ({ ...c, createdAt: new Date(c.createdAt) })));
    } catch (e) {
      console.error('Erro loading campaigns:', e);
    }
  };

  const loadQuotes = async () => {
    try {
      const res = await fetch('/api/quotes');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setQuotes(data.map((q: any) => ({ ...q, createdAt: new Date(q.createdAt), updatedAt: new Date(q.updatedAt) })));
    } catch (e) {
      console.error('Erro loading quotes:', e);
    }
  };

  const loadActiveSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setActiveSessions(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Erro loading sessions:', e);
      setActiveSessions([]);
    }
  };

  const loadSession = async (senderId: string) => {
    try {
      const res = await fetch(`/api/session/${senderId}`, {
        headers: { Accept: 'application/json' },
      });

      const contentType = res.headers.get('content-type') || '';
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      if (!contentType.includes('application/json')) {
        throw new Error(`Resposta inválida: ${contentType || 'sem content-type'}`);
      }

      const raw = (await res.json()) as SessionApiResponse;
      setCurrentSession(sanitizeSession(senderId, raw));
    } catch (e) {
      console.error('Erro loading session:', e);
      setCurrentSession(EMPTY_SESSION(senderId));
    }
  };

  const suggestionChips = useMemo(() => {
    if (!currentSession || currentSession.service === 'none') {
      return ['Formação Portugal', 'Agendamento Férias', 'Agendamento Estudante/Contrato', 'Passagens', 'Reserva de Hotel'];
    }

    switch (currentSession.step) {
      case 'formacao_idade':
      case 'inicio':
        if (currentSession.service === 'formacao') return ['18', '19', '20', '25'];
        if (currentSession.service === 'ferias') return ['É para mim', 'É para outra pessoa'];
        if (currentSession.service === 'agendamento_consular') return ['Estudante', 'Contrato de trabalho'];
        if (currentSession.service === 'passagem') return ['Lisboa', 'Paris', 'Boston'];
        if (currentSession.service === 'reserva_hotel') return ['1 a 5 de abril', '10 a 15 de maio'];
        return ['Reiniciar'];
      case 'formacao_escolaridade':
        return ['12 ano', '11 ano', 'Licenciatura'];
      case 'formacao_curso':
        return ['Auxiliar de Ação Educativa', 'Marketing Digital', 'Profissional de Turismo'];
      case 'ferias_email':
        return ['Reiniciar'];
      case 'ferias_telefone':
        return ['+2389123456', '+2389912345'];
      case 'passagem_cotacao_enviada':
        return ['Opção 1 - Presencial', 'Opção 2 - Online'];
      case 'agendamento_disponibilidade':
        return ['Esta semana', 'Próxima semana'];
      default:
        return ['Quanto custa?', 'Documentos', 'Onde fica?', 'Reiniciar'];
    }
  }, [currentSession]);

  const sessionBadge = useMemo(() => {
    const serviceLabel = currentSession ? SERVICE_LABELS[currentSession.service] || currentSession.service : 'Menu';
    const stepLabel = currentSession ? STEP_LABELS[currentSession.step] || currentSession.step || 'Início' : 'Início';
    return { serviceLabel, stepLabel };
  }, [currentSession]);

  const validateInputAgainstStep = (text: string) => {
    if (!currentSession) return null;

    if (currentSession.step === 'ferias_email' && !isValidEmail(text)) {
      return 'Digite um email válido. Exemplo: nome@gmail.com';
    }

    if (currentSession.step === 'ferias_telefone' && !isValidPhone(text)) {
      return 'Digite um número válido com pelo menos 7 dígitos. Exemplo: +2389123456';
    }

    if (currentSession.step === 'passagem_pessoas') {
      const num = Number(text);
      if (!Number.isInteger(num) || num <= 0) {
        return 'Digite a quantidade de pessoas em números. Exemplo: 2';
      }
    }

    if (
      (currentSession.step === 'formacao_idade' ||
        (currentSession.service === 'formacao' && currentSession.step === 'inicio')) &&
      !/^\d+$/.test(text)
    ) {
      return 'Digite a idade em números. Exemplo: 19';
    }

    return null;
  };

  const sendMessage = async (textOverride?: string) => {
    const text = (textOverride || inputText).trim();
    if (!text) return;

    const validationError = validateInputAgainstStep(text);
    if (validationError) {
      setInputHint(validationError);
      return;
    }

    setInputHint(null);

    const userMessage: Message = {
      id: `user_${Date.now()}`,
      senderUid: 'client',
      text,
      conversationId: currentConversationId,
      createdAt: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputText('');
    setIsTyping(true);

    setUserConversations((prev) => {
      const existing = prev.find((c) => c.id === currentConversationId);
      if (existing) {
        return prev.map((c) =>
          c.id === currentConversationId ? { ...c, lastMessage: text, updatedAt: new Date() } : c
        );
      }
      return [{ id: currentConversationId, lastMessage: text, updatedAt: new Date() }, ...prev];
    });

    try {
      const res = await fetch('/api/process-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          text,
          senderId: currentConversationId,
          conversationId: currentConversationId,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      const botMessage: Message = {
        id: `bot_${Date.now()}`,
        senderUid: 'bot',
        text: typeof data.replyText === 'string' ? data.replyText : 'Recebi a sua mensagem.',
        conversationId: currentConversationId,
        createdAt: new Date(),
      };

      if (data.material) {
        setMessages((prev) => [
          ...prev,
          botMessage,
          {
            id: `mat_${Date.now()}`,
            senderUid: 'bot',
            fileUrl: data.material.fileUrl,
            fileType: data.material.fileType,
            fileName: data.material.fileName,
            isMaterial: true,
            createdAt: new Date(),
          },
        ]);
      } else {
        setMessages((prev) => [...prev, botMessage]);
      }

      if (data.quote) {
        void loadQuotes();
      }

      await loadSession(currentConversationId);
    } catch (error) {
      console.error('Erro:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          senderUid: 'bot',
          text: `Desculpe, tivemos um problema técnico. Tente novamente ou contacte-nos pelo WhatsApp ${COMPANY_PHONE}.`,
          createdAt: new Date(),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const createNewConversation = () => {
    const newId = `web_${Date.now()}`;
    setCurrentConversationId(newId);
    setCurrentSession(EMPTY_SESSION(newId));
    setMessages(
      INITIAL_MESSAGES.map((m) => ({
        ...m,
        id: `${m.id}_${Date.now()}`,
        conversationId: newId,
        createdAt: new Date(),
      }))
    );
    setShowHistory(false);
  };

  const selectConversation = async (id: string) => {
    setCurrentConversationId(id);
    const saved = localStorage.getItem(`messages_${id}`);
    if (saved) {
      setMessages(
        parseJsonSafe<any[]>(saved, []).map((m: any) => ({
          ...m,
          createdAt: new Date(m.createdAt),
        }))
      );
    } else {
      setMessages(INITIAL_MESSAGES.map((m) => ({ ...m, conversationId: id, createdAt: new Date() })));
    }
    setShowHistory(false);
    await loadSession(id);
  };

  const deleteConversation = (id: string) => {
    if (confirm('Tem certeza que deseja excluir esta conversa?')) {
      setUserConversations((prev) => prev.filter((c) => c.id !== id));
      localStorage.removeItem(`messages_${id}`);
      if (currentConversationId === id) createNewConversation();
    }
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const fileMessage: Message = {
        id: `file_${Date.now()}`,
        senderUid: 'client',
        fileName: file.name,
        fileType: file.type,
        fileUrl: reader.result as string,
        conversationId: currentConversationId,
        createdAt: new Date(),
      };

      setMessages((prev) => [...prev, fileMessage]);

      try {
        await fetch('/api/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject: `Documento recebido - ${currentConversationId}`,
            body: `Cliente enviou: ${file.name}\nTipo: ${file.type}\nData: ${new Date().toLocaleString()}`,
          }),
        });
      } catch (e) {
        console.error('Erro notificando:', e);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleAdminLogin = (e: FormEvent) => {
    e.preventDefault();
    if (adminCodeInput === ADMIN_CODE) {
      setIsAdmin(true);
      setShowAdminLogin(false);
      setAdminCodeInput('');
      setLoginError(false);
      setActiveTab('leads');
      void loadActiveSessions();
      void loadQuotes();
      return;
    }
    setLoginError(true);
  };

  const resetSession = async (senderId: string) => {
    try {
      await fetch(`/api/session/${senderId}/reset`, { method: 'POST' });
      await loadActiveSessions();
      if (senderId === currentConversationId) {
        await loadSession(senderId);
      }
    } catch (e) {
      console.error('Erro resetando:', e);
    }
  };

  const sendQuoteToClient = async (quote: Quote, price: string, observation: string) => {
    try {
      await fetch(`/api/quotes/${quote.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ price, observation }),
      });
      await loadQuotes();
      await loadActiveSessions();
      if (quote.clientId === currentConversationId) {
        await loadSession(currentConversationId);
      }
      setShowQuoteModal(false);
      setSelectedQuote(null);
    } catch (e) {
      console.error('Erro enviando cotação:', e);
    }
  };

  const renderSessionStrip = () => (
    <div className="max-w-4xl mx-auto w-full mb-4">
      <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold uppercase">
            {sessionBadge.serviceLabel}
          </span>
          <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-bold uppercase">
            Etapa: {sessionBadge.stepLabel}
          </span>
          {currentSession?.quoteId && (
            <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-bold uppercase">
              Cotação em andamento
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <CheckCircle2 size={14} className="text-emerald-600" />
          <span>Conversa ligada ao backend</span>
        </div>
      </div>
    </div>
  );

  const renderQuickActions = () => (
    <div className="max-w-4xl mx-auto w-full space-y-3">
      <div className="flex flex-wrap gap-2">
        {suggestionChips.map((chip) => (
          <button
            key={chip}
            type="button"
            onClick={() => sendMessage(chip)}
            className="px-4 py-2 bg-slate-100 hover:bg-emerald-600 hover:text-white text-slate-600 rounded-full text-xs font-bold transition-all whitespace-nowrap border border-slate-200"
          >
            {chip}
          </button>
        ))}
      </div>

      {currentSession?.step === 'ferias_email' && (
        <div className="text-xs text-slate-500 flex items-center gap-2">
          <Mail size={14} className="text-emerald-600" />
          <span>Exemplo: nome@gmail.com</span>
        </div>
      )}

      {currentSession?.step === 'ferias_telefone' && (
        <div className="text-xs text-slate-500 flex items-center gap-2">
          <Phone size={14} className="text-emerald-600" />
          <span>Exemplo: +2389123456</span>
        </div>
      )}
    </div>
  );

  const renderChat = () => (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-8 space-y-2 bg-slate-50/60">
        {renderSessionStrip()}
        <div className="max-w-4xl mx-auto w-full">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} onPreview={setPreviewFile} />
          ))}
          {isTyping && (
            <div className="flex justify-start mb-4">
              <div className="bg-white border border-slate-100 rounded-2xl rounded-tl-none px-4 py-3 flex gap-1 shadow-sm ml-10">
                <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce"></span>
                <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-bounce [animation-delay:0.4s]"></span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-slate-100 bg-white p-4 md:p-6">
        {renderQuickActions()}

        <div className="max-w-4xl mx-auto w-full mt-4 space-y-2">
          {inputHint && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-700 text-sm">
              <AlertCircle size={16} />
              <span>{inputHint}</span>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage();
            }}
            className="flex items-end gap-2 md:gap-4"
          >
            <div className="flex-1 bg-slate-50 rounded-2xl border border-slate-200 p-2 flex items-end shadow-inner">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2.5 text-slate-400 hover:text-emerald-600 transition-colors"
              >
                <Paperclip size={22} />
              </button>
              <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
              <textarea
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  if (inputHint) setInputHint(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage();
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
              className="bg-emerald-600 text-white p-4 rounded-2xl hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg transition-all active:scale-95"
            >
              <Send size={22} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  const renderLeads = () => (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 max-w-7xl mx-auto w-full">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Leads Ativos</h2>
        <button type="button" onClick={() => void loadActiveSessions()} className="p-2 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors">
          <RefreshCw size={20} className="text-slate-600" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {activeSessions.map((session) => (
          <div key={session.senderId} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start mb-4 gap-2">
              <div>
                <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold uppercase">
                  {SERVICE_LABELS[session.service] || session.service}
                </span>
                <p className="text-xs text-slate-400 mt-1">{new Date(session.updatedAt).toLocaleString()}</p>
              </div>
              <span className="px-2 py-1 rounded-lg text-xs font-bold uppercase bg-slate-100 text-slate-600">
                {STEP_LABELS[session.step] || session.step || 'Início'}
              </span>
            </div>

            <div className="space-y-2 mb-4">
              {Object.entries(session.data).slice(0, 4).map(([k, v]) => (
                <div key={k} className="text-sm text-slate-700">
                  <span className="font-medium capitalize">{k}:</span> {v}
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void resetSession(session.senderId)}
                className="flex-1 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-200 transition-colors"
              >
                Resetar
              </button>
              {session.service === 'passagem' && session.quoteId && (
                <button
                  type="button"
                  onClick={() => {
                    const found = quotes.find((q) => q.id === session.quoteId);
                    if (found) {
                      setSelectedQuote(found);
                      setShowQuoteModal(true);
                    }
                  }}
                  className="flex-1 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-colors"
                >
                  Cotar
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {activeSessions.length === 0 && (
        <div className="text-center py-12 text-slate-400">
          <Users size={48} className="mx-auto mb-4 opacity-50" />
          <p>Nenhum lead ativo no momento.</p>
        </div>
      )}
    </div>
  );

  const renderQuotes = () => (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 max-w-7xl mx-auto w-full">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Cotações / Preços</h2>
        <button type="button" onClick={() => void loadQuotes()} className="p-2 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors">
          <RefreshCw size={20} className="text-slate-600" />
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm overflow-x-auto">
        <table className="w-full text-left min-w-[760px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Cliente</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Destino</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Detalhes</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Status</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Preço</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {quotes.map((quote) => (
              <tr key={quote.id} className="hover:bg-slate-50/50">
                <td className="px-6 py-4 font-medium text-slate-900">{quote.clientName}</td>
                <td className="px-6 py-4 text-sm text-slate-600">{quote.destination}</td>
                <td className="px-6 py-4 text-sm text-slate-600 max-w-xs truncate">{quote.details}</td>
                <td className="px-6 py-4">
                  <span
                    className={`px-2 py-1 rounded-lg text-xs font-bold uppercase ${
                      quote.status === 'pending'
                        ? 'bg-amber-100 text-amber-700'
                        : quote.status === 'quoted'
                          ? 'bg-blue-100 text-blue-700'
                          : quote.status === 'accepted'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {quote.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm font-bold text-slate-900">{quote.price || '-'}</td>
                <td className="px-6 py-4">
                  {(quote.status === 'pending' || quote.status === 'quoted') && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedQuote(quote);
                        setShowQuoteModal(true);
                      }}
                      className="text-emerald-600 hover:text-emerald-700 font-bold text-sm flex items-center gap-1"
                    >
                      <DollarSign size={16} /> {quote.status === 'pending' ? 'Inserir Preço' : 'Atualizar'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderMaterials = () => (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 max-w-7xl mx-auto w-full">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Materiais / Documentos</h2>
        <input
          type="file"
          id="new-material"
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
          type="button"
          onClick={() => document.getElementById('new-material')?.click()}
          className="bg-emerald-600 text-white px-6 py-3 rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-emerald-700 shadow-lg"
        >
          <Plus size={20} /> Novo Material
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {materials.map((mat) => (
          <div key={mat.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:border-emerald-300 transition-all">
            <div className="aspect-video bg-slate-100 rounded-xl mb-4 overflow-hidden relative group">
              <img src={mat.fileUrl} alt={mat.title} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2 transition-opacity">
                <button
                  type="button"
                  onClick={() => setPreviewFile({ url: mat.fileUrl, name: mat.fileName, type: mat.fileType })}
                  className="p-2 bg-white rounded-full text-emerald-600"
                >
                  <Eye size={20} />
                </button>
              </div>
            </div>
            <h3 className="font-bold text-lg text-slate-800 mb-1">{mat.title}</h3>
            <p className="text-xs text-slate-400 uppercase font-bold mb-4">{mat.category.replace('_', ' ')}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingMaterial(mat);
                  setShowMaterialModal(true);
                }}
                className="flex-1 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-200"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (confirm('Excluir este material?')) {
                    const newMaterials = materials.filter((m) => m.id !== mat.id);
                    await fetch('/api/materials', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(newMaterials),
                    });
                    setMaterials(newMaterials);
                  }
                }}
                className="p-2 text-red-500 hover:bg-red-50 rounded-xl"
              >
                <Trash2 size={20} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderCampaigns = () => (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 max-w-7xl mx-auto w-full">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Campanhas Ativas</h2>
        <button
          type="button"
          onClick={() => {
            setEditingCampaign(null);
            setShowCampaignModal(true);
          }}
          className="bg-emerald-600 text-white px-6 py-3 rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-emerald-700 shadow-lg"
        >
          <Plus size={20} /> Nova Campanha
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {campaigns.map((cp) => (
          <div key={cp.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:border-emerald-300 transition-all">
            <div className="flex justify-between items-start gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <h3 className="font-bold text-lg text-slate-800">{cp.title}</h3>
                  <button
                    type="button"
                    onClick={async () => {
                      const updated = campaigns.map((c) => (c.id === cp.id ? { ...c, active: !c.active } : c));
                      await fetch('/api/campaigns', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updated),
                      });
                      setCampaigns(updated);
                    }}
                    className={`px-3 py-1 rounded-full text-xs font-bold uppercase transition-colors ${
                      cp.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {cp.active ? 'Ativa' : 'Inativa'}
                  </button>
                </div>
                <p className="text-sm text-slate-600 mb-3">{cp.context}</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {cp.keywords.map((k, i) => (
                    <span key={i} className="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold">
                      #{k}
                    </span>
                  ))}
                </div>
                {(cp.discount || cp.price) && (
                  <div className="flex gap-4 text-sm flex-wrap">
                    {cp.discount && <span className="text-emerald-600 font-bold">🔥 {cp.discount}</span>}
                    {cp.price && <span className="text-slate-700 font-bold">💰 {cp.price.toLocaleString()} CVE</span>}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingCampaign(cp);
                    setShowCampaignModal(true);
                  }}
                  className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-xl transition-colors"
                >
                  <Edit3 size={20} />
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (confirm('Excluir esta campanha?')) {
                      const updated = campaigns.filter((c) => c.id !== cp.id);
                      await fetch('/api/campaigns', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updated),
                      });
                      setCampaigns(updated);
                    }
                  }}
                  className="p-2 text-red-400 hover:bg-red-50 rounded-xl transition-colors"
                >
                  <Trash2 size={20} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      <header className="bg-white border-b border-slate-200 px-4 md:px-8 py-4 flex items-center justify-between sticky top-0 z-30 shadow-sm gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center shadow-lg shrink-0">
            <Plane className="text-white w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-emerald-700 truncate">Aventour</h1>
            <p className="text-[10px] font-medium text-slate-400 uppercase tracking-widest">Painel Comercial</p>
          </div>
        </div>

        {isAdmin && (
          <nav className="hidden lg:flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            {[
              { id: 'chat', label: 'Chat', icon: MessageSquare },
              { id: 'leads', label: 'Leads', icon: Users },
              { id: 'quotes', label: 'Preços', icon: DollarSign },
              { id: 'materials', label: 'Materiais', icon: Folder },
              { id: 'campaigns', label: 'Campanhas', icon: Tag },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
                  activeTab === tab.id ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <tab.icon size={16} />
                {tab.label}
              </button>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-2 shrink-0">
          {!isAdmin && (
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              className={`p-2 rounded-xl transition-all ${
                showHistory ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'
              }`}
            >
              <MessageSquare size={20} />
            </button>
          )}
          {isAdmin && (
            <button type="button" onClick={() => setIsAdmin(false)} className="p-2 text-slate-400 hover:text-red-500 transition-colors">
              <LogOut size={20} />
            </button>
          )}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 rounded-full border border-emerald-100">
            <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
            <span className="text-[10px] font-bold text-emerald-700 uppercase">Online</span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <AnimatePresence>
          {showHistory && !isAdmin && (
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              className="absolute inset-y-0 left-0 w-72 bg-white border-r border-slate-200 z-30 shadow-2xl flex flex-col"
            >
              <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-bold text-slate-800">Conversas</h3>
                <button type="button" onClick={() => setShowHistory(false)} className="p-2 text-slate-400 hover:text-slate-600">
                  <X size={20} />
                </button>
              </div>
              <div className="p-4">
                <button
                  type="button"
                  onClick={createNewConversation}
                  className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-emerald-700 shadow-md"
                >
                  <Plus size={18} /> Nova Conversa
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {userConversations.map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => void selectConversation(conv.id)}
                    className={`p-3 rounded-xl cursor-pointer transition-all group relative ${
                      currentConversationId === conv.id
                        ? 'bg-emerald-50 border border-emerald-100'
                        : 'hover:bg-slate-50 border border-transparent'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <p
                        className={`text-xs font-bold truncate pr-6 ${
                          currentConversationId === conv.id ? 'text-emerald-700' : 'text-slate-700'
                        }`}
                      >
                        {conv.lastMessage || 'Nova conversa'}
                      </p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteConversation(conv.id);
                        }}
                        className="absolute top-3 right-3 p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400">
                      {conv.updatedAt.toLocaleDateString()}{' '}
                      {conv.updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {isAdmin
          ? activeTab === 'chat'
            ? renderChat()
            : activeTab === 'leads'
              ? renderLeads()
              : activeTab === 'quotes'
                ? renderQuotes()
                : activeTab === 'materials'
                  ? renderMaterials()
                  : renderCampaigns()
          : renderChat()}
      </main>

      <footer className="bg-white border-t border-slate-100 px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-[10px] text-slate-400">
          <MapPin size={12} className="text-emerald-600" />
          <span>Achada São Filipe, Praia (ao lado de Calú e Angela)</span>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-[10px] text-slate-400 font-bold uppercase">Aventour © 2026</p>
          <button type="button" onClick={() => setShowAdminLogin(true)} className="p-1.5 text-slate-300 hover:text-emerald-600 transition-colors">
            <Lock size={14} />
          </button>
        </div>
      </footer>

      <AnimatePresence>
        {showAdminLogin && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-3xl p-8 w-full max-w-sm shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold">Acesso Restrito</h3>
                <button type="button" onClick={() => setShowAdminLogin(false)} className="text-slate-400 hover:text-slate-600">
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
                    className={`w-full bg-slate-50 border ${
                      loginError ? 'border-red-500' : 'border-slate-200'
                    } rounded-xl px-4 py-3 focus:ring-2 focus:ring-emerald-500 outline-none`}
                    placeholder="••••••••"
                  />
                  {loginError && (
                    <p className="text-red-500 text-[10px] font-bold mt-1 uppercase">Código incorreto</p>
                  )}
                </div>
                <button type="submit" className="w-full py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 shadow-lg">
                  Entrar no Painel
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal
        title={editingMaterial ? 'Editar Material' : 'Novo Material'}
        isOpen={showMaterialModal}
        onClose={() => {
          setShowMaterialModal(false);
          setEditingMaterial(null);
          setNewMaterialFile(null);
        }}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const title = formData.get('title') as string;
            const category = formData.get('category') as Material['category'];

            let newMaterials: Material[] = materials;
            if (editingMaterial) {
              newMaterials = materials.map((m) => (m.id === editingMaterial.id ? { ...m, title, category } : m));
            } else if (newMaterialFile) {
              const newMat: Material = {
                id: Date.now().toString(),
                title,
                category,
                fileName: newMaterialFile.file.name,
                fileType: newMaterialFile.file.type,
                fileUrl: newMaterialFile.url,
                createdAt: new Date(),
              };
              newMaterials = [...materials, newMat];
            }

            await fetch('/api/materials', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(newMaterials),
            });
            setMaterials(newMaterials);
            setShowMaterialModal(false);
            setEditingMaterial(null);
            setNewMaterialFile(null);
          }}
          className="space-y-4"
        >
          {(newMaterialFile || editingMaterial) && (
            <div className="aspect-video rounded-xl overflow-hidden border border-slate-200 mb-4">
              <img
                src={newMaterialFile?.url || editingMaterial?.fileUrl}
                alt="Preview"
                className="w-full h-full object-cover"
              />
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Título</label>
            <input
              name="title"
              defaultValue={editingMaterial?.title}
              required
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Categoria</label>
            <select
              name="category"
              defaultValue={editingMaterial?.category || 'docs_ferias'}
              required
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
            >
              <option value="docs_ferias">Docs Férias</option>
              <option value="docs_contrato">Docs Contrato</option>
              <option value="docs_estudante">Docs Estudante</option>
              <option value="dados_bancarios">Dados Bancários</option>
            </select>
          </div>
          <button type="submit" className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 shadow-lg">
            {editingMaterial ? 'Salvar' : 'Criar'}
          </button>
        </form>
      </Modal>

      <Modal
        title={editingCampaign ? 'Editar Campanha' : 'Nova Campanha'}
        isOpen={showCampaignModal}
        onClose={() => {
          setShowCampaignModal(false);
          setEditingCampaign(null);
        }}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const title = formData.get('title') as string;
            const context = formData.get('context') as string;
            const keywords = (formData.get('keywords') as string)
              .split(',')
              .map((k) => k.trim())
              .filter(Boolean);
            const discount = formData.get('discount') as string;
            const price = parseFloat(formData.get('price') as string) || undefined;

            const newCampaign: Campaign = {
              id: editingCampaign?.id || Date.now().toString(),
              title,
              description: context,
              keywords,
              context,
              discount: discount || undefined,
              price,
              active: editingCampaign?.active ?? true,
              createdAt: editingCampaign?.createdAt || new Date(),
            };

            const updated = editingCampaign
              ? campaigns.map((c) => (c.id === editingCampaign.id ? newCampaign : c))
              : [...campaigns, newCampaign];

            await fetch('/api/campaigns', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updated),
            });
            setCampaigns(updated);
            setShowCampaignModal(false);
            setEditingCampaign(null);
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Título da Campanha</label>
            <input
              name="title"
              defaultValue={editingCampaign?.title}
              required
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Descrição/Contexto</label>
            <textarea
              name="context"
              defaultValue={editingCampaign?.context}
              required
              rows={3}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Keywords (separadas por vírgula)</label>
            <input
              name="keywords"
              defaultValue={editingCampaign?.keywords.join(', ')}
              required
              placeholder="sal, verão, praia, promoção"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Desconto</label>
              <input
                name="discount"
                defaultValue={editingCampaign?.discount}
                placeholder="20% OFF"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Preço (CVE)</label>
              <input
                name="price"
                type="number"
                defaultValue={editingCampaign?.price}
                placeholder="45000"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
          </div>
          <button type="submit" className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 shadow-lg">
            {editingCampaign ? 'Salvar Campanha' : 'Criar Campanha'}
          </button>
        </form>
      </Modal>

      <Modal
        title="Inserir Preço da Cotação"
        isOpen={showQuoteModal}
        onClose={() => {
          setShowQuoteModal(false);
          setSelectedQuote(null);
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const price = formData.get('price') as string;
            const observation = formData.get('observation') as string;
            if (selectedQuote) void sendQuoteToClient(selectedQuote, price, observation);
          }}
          className="space-y-4"
        >
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
            <p className="text-xs font-bold text-slate-400 uppercase mb-1">Cliente</p>
            <p className="font-bold text-slate-800">{selectedQuote?.clientName}</p>
            <p className="text-sm text-slate-600 mt-1">{selectedQuote?.destination}</p>
            <p className="text-xs text-slate-500">{selectedQuote?.details}</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Preço Final</label>
            <input
              name="price"
              defaultValue={selectedQuote?.price}
              required
              placeholder="Ex: 45.000 CVE"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Observação</label>
            <textarea
              name="observation"
              defaultValue={selectedQuote?.observation}
              rows={2}
              placeholder="Inclui bagagem, taxas, etc."
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none resize-none"
            />
          </div>
          <button type="submit" className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 shadow-lg">
            Enviar Preço ao Cliente
          </button>
        </form>
      </Modal>

      <AnimatePresence>
        {previewFile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-4 md:p-10"
          >
            <button
              type="button"
              onClick={() => setPreviewFile(null)}
              className="absolute top-6 right-6 text-white/70 hover:text-white p-2 z-50"
            >
              <X size={32} />
            </button>
            <div className="max-w-5xl w-full h-full flex items-center justify-center">
              {previewFile.type.startsWith('image/') ? (
                <img
                  src={previewFile.url}
                  alt="Preview"
                  className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
                />
              ) : (
                <div className="bg-white rounded-3xl p-10 text-center max-w-md">
                  <FileText size={64} className="text-emerald-600 mx-auto mb-6" />
                  <h3 className="text-xl font-bold text-slate-900 mb-2">{previewFile.name}</h3>
                  <a
                    href={previewFile.url}
                    download={previewFile.name}
                    className="inline-flex items-center gap-2 bg-emerald-600 text-white px-8 py-3 rounded-xl font-bold hover:bg-emerald-700"
                  >
                    <Download size={20} /> Baixar
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

