import type { JackboxUniverseApi } from "../shared/types";

declare global {
  interface Window {
    jackboxUniverse: JackboxUniverseApi;
  }
}

export {};
