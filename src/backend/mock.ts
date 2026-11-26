// Backend financier simulé, en attendant la documentation de l'environnement de test SAFINUM.
// Données fictives uniquement. Barème : 1 % du montant, minimum 100 FCFA, maximum 2 500 FCFA
// (valeur d'exemple, à remplacer par le barème réel fourni par SAFINUM).

import type { Contact, FeeKind, FeeQuote, FinancialBackend, OpResult, Transaction } from './types.ts';

interface Account { id: string; holder: string; balance: number; contacts: Contact[]; history: Transaction[] }

export class MockBackend implements FinancialBackend {
  readonly name = 'mock';
  private accounts = new Map<string, Account>();
  private seq = 1000;
  readonly dailyLimit = 500_000;

  constructor() { this.reset(); }

  reset(): void {
    this.accounts.clear();
    this.accounts.set('demo', {
      id: 'demo', holder: 'Client Démo', balance: 150_000,
      contacts: [
        { id: 'c1', name: 'Paul Mbarga', phone: '677112233' },
        { id: 'c2', name: 'Paul Ekwalla', phone: '699445566' },
        { id: 'c3', name: 'Marie Ngo Bassa', phone: '655778899' },
        { id: 'c4', name: 'Aminatou Bello', phone: '690001122' },
      ],
      history: [
        { id: 'T0997', date: '2026-11-20T09:12:00Z', type: 'transfer_in', amount: 50_000, fee: 0, counterparty: 'Aminatou Bello', status: 'success' },
        { id: 'T0998', date: '2026-11-21T17:40:00Z', type: 'bill', amount: 12_500, fee: 125, counterparty: 'ENEO', status: 'success' },
        { id: 'T0999', date: '2026-11-22T08:05:00Z', type: 'transfer_out', amount: 10_000, fee: 100, counterparty: 'Marie Ngo Bassa', status: 'success' },
      ],
    });
  }

  private acc(id: string): Account {
    const a = this.accounts.get(id);
    if (!a) throw new Error(`compte inconnu : ${id}`);
    return a;
  }

  fee(kind: FeeKind, amount: number): number {
    if (kind === 'airtime') return 0;
    return Math.min(2_500, Math.max(100, Math.round(amount * 0.01)));
  }

  async getBalance(accountId: string) { return { ok: true as const, value: { balance: this.acc(accountId).balance, currency: 'XAF' as const } }; }

  async listContacts(accountId: string) { return this.acc(accountId).contacts; }

  async quoteFee(_accountId: string, kind: FeeKind, amount: number): Promise<OpResult<FeeQuote>> {
    if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, code: 'invalid_amount', message: 'montant invalide' };
    const fee = this.fee(kind, amount);
    return { ok: true, value: { amount, fee, total: amount + fee, rule: kind === 'airtime' ? 'gratuit' : '1 % (min. 100, max. 2 500 FCFA)' } };
  }

  private debit(a: Account, type: Transaction['type'], amount: number, fee: number, counterparty: string): OpResult<Transaction> {
    if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, code: 'invalid_amount', message: 'montant invalide' };
    if (amount > this.dailyLimit) return { ok: false, code: 'limit_exceeded', message: 'plafond dépassé', details: { limit: this.dailyLimit } };
    if (a.balance < amount + fee) {
      return { ok: false, code: 'insufficient_funds', message: 'solde insuffisant', details: { balance: a.balance, required: amount + fee, missing: amount + fee - a.balance } };
    }
    a.balance -= amount + fee;
    const tx: Transaction = { id: `T${++this.seq}`, date: new Date().toISOString(), type, amount, fee, counterparty, status: 'success' };
    a.history.push(tx);
    return { ok: true, value: tx };
  }

  async transfer(accountId: string, to: { name?: string; phone?: string }, amount: number) {
    const a = this.acc(accountId);
    const c = a.contacts.find((x) => (to.phone && x.phone === to.phone) || (to.name && x.name === to.name));
    const label = c?.name ?? to.phone;
    if (!label) return { ok: false as const, code: 'unknown_beneficiary' as const, message: 'bénéficiaire inconnu' };
    return this.debit(a, 'transfer_out', amount, this.fee('transfer', amount), label);
  }

  async buyAirtime(accountId: string, phone: string, amount: number) {
    return this.debit(this.acc(accountId), 'airtime', amount, 0, phone);
  }

  async payBill(accountId: string, biller: string, amount: number) {
    return this.debit(this.acc(accountId), 'bill', amount, this.fee('bill', amount), biller);
  }

  async withdraw(accountId: string, amount: number) {
    if (amount % 500 !== 0) return { ok: false as const, code: 'invalid_amount' as const, message: 'le guichet ne délivre que des multiples de 500 FCFA' };
    return this.debit(this.acc(accountId), 'withdrawal', amount, this.fee('withdraw', amount), 'GAB');
  }

  async history(accountId: string, limit: number) {
    return { ok: true as const, value: this.acc(accountId).history.slice(-limit).reverse() };
  }
}
