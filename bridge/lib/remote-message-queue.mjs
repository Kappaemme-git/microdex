import { randomUUID } from 'node:crypto';

const START_OBSERVATION_TIMEOUT_MS = 8_000;

function threadIsBusy(state, threadId) {
  const thread = state?.threads?.find((entry) => entry.id === threadId);
  return thread?.status === 'thinking';
}

export class RemoteMessageQueue {
  #items = [];
  #activeDispatch = null;
  #draining = false;
  #startTimer = null;
  #getState;
  #send;
  #onChange;
  #makeId;
  #now;

  constructor({
    getState,
    send,
    onChange = () => {},
    makeId = randomUUID,
    now = Date.now,
  }) {
    this.#getState = getState;
    this.#send = send;
    this.#onChange = onChange;
    this.#makeId = makeId;
    this.#now = now;
  }

  list() {
    return this.#items.map((item) => ({ ...item }));
  }

  enqueue({ threadId, text }) {
    const cleanThreadId = String(threadId || '').trim();
    const cleanText = String(text || '').trim();
    if (!cleanThreadId) throw Object.assign(new Error('Missing threadId.'), { statusCode: 400 });
    if (!cleanText) throw Object.assign(new Error('Message cannot be empty.'), { statusCode: 400 });
    if (cleanText.length > 12_000) {
      throw Object.assign(new Error('Message is too long.'), { statusCode: 400 });
    }

    const item = {
      id: this.#makeId(),
      threadId: cleanThreadId,
      text: cleanText,
      status: 'queued',
      createdAt: this.#now(),
    };
    this.#items.push(item);
    this.#onChange();
    queueMicrotask(() => void this.drain());
    return { ...item };
  }

  remove(id) {
    const index = this.#items.findIndex(
      (item) => item.id === id && item.status === 'queued',
    );
    if (index < 0) return false;
    this.#items.splice(index, 1);
    this.#onChange();
    return true;
  }

  removeThread(threadId) {
    const target = String(threadId || '').trim();
    if (!target) return 0;
    const previousLength = this.#items.length;
    this.#items = this.#items.filter(
      (item) => item.threadId !== target || item.status !== 'queued',
    );
    const removed = previousLength - this.#items.length;
    if (removed) this.#onChange();
    return removed;
  }

  async handleCodexChange() {
    const state = await this.#getState();
    if (this.#activeDispatch) {
      if (threadIsBusy(state, this.#activeDispatch.threadId)) {
        this.#activeDispatch.sawBusy = true;
      } else if (this.#activeDispatch.sawBusy) {
        this.#completeActiveDispatch();
      }
    }
    await this.drain(state);
  }

  async drain(knownState) {
    if (this.#draining || this.#activeDispatch || !this.#items.length) return;
    const item = this.#items[0];
    if (!item) return;
    this.#draining = true;
    try {
      const state = knownState ?? await this.#getState();
      if (threadIsBusy(state, item.threadId)) return;

      item.status = 'sending';
      delete item.error;
      this.#onChange();
      await this.#send({ ...item });
      this.#activeDispatch = {
        messageId: item.id,
        threadId: item.threadId,
        sawBusy: false,
      };
      this.#armStartObservation();
      this.#onChange();
    } catch (error) {
      item.status = 'queued';
      item.error = error?.message || 'Message could not be sent.';
      this.#onChange();
    } finally {
      this.#draining = false;
    }
  }

  #armStartObservation() {
    if (this.#startTimer) clearTimeout(this.#startTimer);
    this.#startTimer = setTimeout(() => {
      this.#startTimer = null;
      if (!this.#activeDispatch?.sawBusy) {
        this.#completeActiveDispatch();
        void this.drain();
      }
    }, START_OBSERVATION_TIMEOUT_MS);
  }

  #completeActiveDispatch() {
    if (this.#startTimer) clearTimeout(this.#startTimer);
    this.#startTimer = null;
    const messageId = this.#activeDispatch?.messageId;
    if (messageId) {
      const index = this.#items.findIndex(
        (item) => item.id === messageId && item.status === 'sending',
      );
      if (index >= 0) this.#items.splice(index, 1);
    }
    this.#activeDispatch = null;
    this.#onChange();
  }

  close() {
    if (this.#startTimer) clearTimeout(this.#startTimer);
    this.#startTimer = null;
  }
}
