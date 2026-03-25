export type UserRole = 'admin' | 'client';

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  photoURL?: string;
}

export interface Conversation {
  id: string;
  userId: string;
  userName: string;
  lastMessage: string;
  updatedAt: Date;
  saleStatus: 'new' | 'attending' | 'waiting_price' | 'negotiating' | 'closed' | 'lost';
}

export interface Message {
  id: string;
  senderUid: string;
  conversationId?: string;
  text?: string;
  fileUrl?: string;
  fileType?: string;
  fileName?: string;
  createdAt: Date;
  isMaterial?: boolean;
}

export interface Quote {
  id: string;
  clientUid: string;
  clientName: string;
  details: string;
  destination: string;
  date: string;
  passengers: number;
  status: 'pending' | 'quoted' | 'closed' | 'lost';
  price?: string;
  observation?: string;
  createdAt: Date;
}

export interface Campaign {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  context: string;
  serviceType: string;
  active: boolean;
  createdAt: Date;
}

export interface Material {
  id: string;
  title: string;
  category: 'docs_ferias' | 'docs_contrato' | 'docs_estudante' | 'dados_bancarios' | 'outras_instrucoes';
  fileUrl: string;
  fileType: string;
  fileName: string;
  createdAt: Date;
}

export interface Sale {
  id: string;
  clientUid: string;
  clientName: string;
  service: string;
  value: number;
  createdAt: Date;
}
