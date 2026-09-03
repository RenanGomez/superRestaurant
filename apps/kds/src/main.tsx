import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";

import { App } from "./App.js";
import { readKdsConfig } from "./config.js";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("KDS_ROOT_MISSING");

try {
  const config = readKdsConfig(import.meta.env);
  const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { autoRefreshToken: true, detectSessionInUrl: false, persistSession: true },
  });
  createRoot(root).render(<StrictMode><App config={config} supabase={supabase} /></StrictMode>);
} catch {
  root.innerHTML = '<main class="fatal"><h1>KDS no configurado</h1><p>Revisa la configuración pública del dispositivo.</p></main>';
}
