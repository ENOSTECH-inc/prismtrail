import { LocalStorageBackend } from "./primary-storage.mjs";

export class JsonStore {
  constructor(backendOrDirectory, namespace) {
    if (typeof backendOrDirectory === "string") {
      const parts = backendOrDirectory.split(/[\\/]/);
      this.namespace = parts.pop();
      this.backend = new LocalStorageBackend(parts.join("/") || ".");
    } else {
      this.backend = backendOrDirectory;
      this.namespace = namespace;
    }
  }

  async ensure() {
    await this.backend.ensure(this.namespace);
  }

  async save(value) {
    return this.backend.save(this.namespace, value);
  }

  async get(id) {
    return this.backend.get(this.namespace, id);
  }

  async list() {
    const values = await this.backend.list(this.namespace);
    return values.sort((a, b) =>
      String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt))
    );
  }

  async delete(id) {
    await this.backend.delete(this.namespace, id);
  }
}
