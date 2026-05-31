"use client";

/**
 * F-PARAMETRES-04 (#234) — `ModesEditor` STUB (red phase placeholder).
 *
 * Real implementation lands in the green-phase commit. This stub exists so
 * the test file imports without a module-not-found error.
 */

import { useForm } from "react-hook-form";

import { Switch } from "@/components/ui/switch";

export type ModesValue = {
  delivery?: boolean;
  clickAndCollect?: boolean;
};

export type AcceptedModesPatch = {
  acceptedModes: {
    delivery: boolean;
    clickAndCollect: boolean;
  };
};

export type ModesEditorProps = {
  value: ModesValue;
  onSave: (patch: AcceptedModesPatch) => Promise<void>;
};

export function ModesEditor(_props: ModesEditorProps): React.ReactElement {
  // Reference imports so the stub at least typechecks the contract.
  useForm();
  void Switch;
  return null as unknown as React.ReactElement;
}
