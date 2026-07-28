import { JsonStore } from "./json-store.mjs";

export class RunStore {
  constructor(backendOrDirectory, namespace = "runs") {
    this.store = new JsonStore(backendOrDirectory, namespace);
  }

  async ensure() {
    await this.store.ensure();
  }

  async save(run) {
    return this.store.save(run);
  }

  async get(id) {
    return this.store.get(id);
  }

  async list() {
    const runs = await this.store.list();
    return runs
      .map((run) => ({
        id: run.id,
        createdAt: run.createdAt,
        question: run.question,
        agent: run.agent,
        summary: run.summary
      }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
}
