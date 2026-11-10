"use server"

import { revealEnvironmentSecret } from "./environment-server"
import type { EnvironmentRevealResult } from "./environment"

export async function revealEnvironmentSecretAction(name: unknown): Promise<EnvironmentRevealResult> {
  try {
    return await revealEnvironmentSecret(name)
  } catch {
    // 不將原始例外、環境值或憑證寫入回應／日誌。
    return { ok: false, message: "暫時無法讀取環境值，請稍後再試。" }
  }
}
