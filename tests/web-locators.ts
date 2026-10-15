import type { Page } from 'playwright'
import { requireDshHost } from '../scripts/dsh-hosts.ts'

/** Native composer labels before and after DSH 0.1.5-alpha.1. */
export const COMPOSER_LABEL = /^(?:发消息或做任务… \/ 调用指令 @ 文件或对话|发消息或创建任务, \/ 调用指令, @ 文件或对话)$/u

/** Open Settings through the entry shipped by the fixed host. */
export async function openHostSettings(page: Page, version: string): Promise<void> {
  if (requireDshHost(version).settingsAccountMenu) {
    await page.getByRole('button', { name: '账号菜单', exact: true }).click()
    await page.getByRole('menuitem', { name: '设置', exact: true }).click()
  } else {
    await page.getByRole('button', { name: '设置', exact: true }).click()
  }
}
