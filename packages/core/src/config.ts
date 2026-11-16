/** `aicommerce.config.json` at the root of a shop. */
export interface AicommerceConfig {
  /**
   * Packages whose default export is a module. Listed means installed, not enabled: the owner
   * switches each on with module.enable. `ai-commerce add` writes this list.
   */
  modules: string[]
}
