"use client";

import { useState } from "react";
import type { OrderDetailV1, PaymentCollectionSummaryV1 } from "@super-restaurant/shared-types";
import { buildCustomerTicket, type PrintHeader } from "../../../lib/print-documents";
import { PrintPreview } from "../print-preview";

export function ReceiptPrintButton({ order, payment, header }: {
  readonly order: OrderDetailV1;
  readonly payment: PaymentCollectionSummaryV1;
  readonly header: PrintHeader;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="min-h-11 rounded-xl bg-accent px-4 text-sm font-semibold text-white focus-visible:outline-2" onClick={() => setOpen(true)}>Imprimir ticket</button>
    {open && <PrintPreview documents={[buildCustomerTicket(order, [payment], header)]} onClose={() => setOpen(false)} />}
  </>;
}
