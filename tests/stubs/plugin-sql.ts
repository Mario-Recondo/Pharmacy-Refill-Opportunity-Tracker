// Aliased in place of "@tauri-apps/plugin-sql" by vitest.config.ts.
// Database.load hands back the in-memory fake; migrations already ran there.
import { fakeDatabase } from "../helpers/fakeTauri";

export default class Database {
  static async load(_url: string): Promise<typeof fakeDatabase> {
    return fakeDatabase;
  }
}
