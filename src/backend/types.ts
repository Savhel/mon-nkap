// Contrat entre le moteur linguistique et un service financier (simulé ou réel).
// Le moteur ne connaît que cette interface : brancher le backend SAFINUM, une banque ou un
// opérateur Mobile Money revient à écrire un adaptateur, sans toucher au moteur.

export interface Contact { id: string; name: string; phone: string }

export interface Transaction {
  id: string;
  date: string; // ISO 8601
  type: 'transfer_out' | 'transfer_in' | 'airtime' | 'bill' | 'deposit' | 'withdrawal';
  amount: number;
  fee: number;
  counterparty?: string;
  status: 'success' | 'failed';
}

export type FeeKind = 'transfer' | 'airtime' | 'bill' | 'withdraw';

export interface FeeQuote { amount: number; fee: number; total: number; rule: string }

export type OpResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: 'insufficient_funds' | 'unknown_beneficiary' | 'limit_exceeded' | 'invalid_amount' | 'backend_error'; message: string; details?: Record<string, number | string> };

export interface FinancialBackend {
  readonly name: string;
  getBalance(accountId: string): Promise<OpResult<{ balance: number; currency: 'XAF' }>>;
  listContacts(accountId: string): Promise<Contact[]>;
  quoteFee(accountId: string, kind: FeeKind, amount: number): Promise<OpResult<FeeQuote>>;
  transfer(accountId: string, to: { name?: string; phone?: string }, amount: number): Promise<OpResult<Transaction>>;
  buyAirtime(accountId: string, phone: string, amount: number): Promise<OpResult<Transaction>>;
  payBill(accountId: string, biller: string, amount: number): Promise<OpResult<Transaction>>;
  /** Retrait d'espèces (guichet automatique, agent). */
  withdraw(accountId: string, amount: number): Promise<OpResult<Transaction>>;
  history(accountId: string, limit: number): Promise<OpResult<Transaction[]>>;
}
