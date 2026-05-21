"use client";

import TaxCardFlowForm from "./TaxCardFlowForm";

export default function TaxForm({ onClose }: { onClose?: () => void }) {
  return <TaxCardFlowForm onClose={onClose} />;
}
