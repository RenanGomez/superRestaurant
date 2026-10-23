export interface E2eRoute {
  readonly path: string;
  readonly label: string;
}

/** Rutas autenticadas (fuente: src/app/app/app-nav.tsx y page.tsx bajo src/app/app). */
export const APP_ROUTES: readonly E2eRoute[] = [
  { path: "/app", label: "Inicio" },
  { path: "/app/tables", label: "Mesas" },
  { path: "/app/menu", label: "Menú" },
  { path: "/app/caja", label: "Caja" },
  { path: "/app/orders", label: "Órdenes" },
  { path: "/app/deliveries", label: "Entregas" },
  { path: "/app/customers", label: "Clientes" },
  { path: "/app/capture", label: "Captura telefónica" },
  { path: "/app/delivery-zones", label: "Zonas de entrega" },
  { path: "/app/reports/day", label: "Resumen del día" },
  { path: "/app/system-admin/restaurants", label: "Administración del sistema" },
];

export const PUBLIC_ROUTES: readonly E2eRoute[] = [
  { path: "/login", label: "Login" },
  { path: "/reset-password", label: "Restablecer contraseña" },
];
