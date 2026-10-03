"use client";

import { createContext, useContext, type ReactNode } from "react";

const MenuImageBaseUrlContext = createContext("");

export function MenuImageBaseUrlProvider({ children, url }: { readonly children: ReactNode; readonly url: string }): ReactNode {
  return <MenuImageBaseUrlContext value={url}>{children}</MenuImageBaseUrlContext>;
}

export function useMenuImageBaseUrl(): string {
  return useContext(MenuImageBaseUrlContext);
}
