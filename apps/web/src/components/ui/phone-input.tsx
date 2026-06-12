"use client";

/**
 * PWA checkout — `<PhoneInput>`: international phone field with a country
 * flag/dial-code selector (default France `+33`), per-country live formatting,
 * and an **E.164** output value (e.g. `+33612345678`).
 *
 * Why: the checkout previously used a free-text `<input type="tel">`. A customer
 * could submit a junk number; it was only validated as "≥ 6 digits". A payment
 * then went through with `124304859385935`, and Uber Direct's Create Delivery
 * rejected it post-payment (`dropoff_phone_number: "not valid."`) → the order
 * auto-aborted + auto-refunded. Emitting E.164 (+ gating « Payer » on
 * `isValidPhoneNumber`, see `lib/checkout-gate/decide-contact-form-valid`)
 * stops an invalid number ever reaching payment.
 *
 * Built on `react-phone-number-input` (flags + country select + formatting) over
 * `libphonenumber-js` (parse/format/validate). The native country `<select>` it
 * renders works inside the checkout page (no portal needed). Styled to match the
 * other checkout inputs: the wrapper carries the border + emerald focus ring, the
 * inner number input is borderless so the flag selector + number read as ONE
 * field.
 */
import "react-phone-number-input/style.css";
import PhoneInputBase, { type Value } from "react-phone-number-input";

export type PhoneInputProps = {
  /** Controlled E.164 value (`""` when empty). */
  value: string;
  /** Receives the E.164 string (`""` when the field is cleared/incomplete). */
  onChange: (value: string) => void;
  /** Forwarded to the underlying number input (form field name). */
  name?: string;
  /** Optional id for label association. */
  id?: string;
};

export function PhoneInput({
  value,
  onChange,
  name,
  id,
}: PhoneInputProps): React.JSX.Element {
  return (
    <div className="flex w-full items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 focus-within:border-emerald-600 focus-within:ring-2 focus-within:ring-emerald-200">
      <PhoneInputBase
        international
        defaultCountry="FR"
        value={(value.length > 0 ? value : undefined) as Value | undefined}
        onChange={(next) => onChange((next ?? "") as string)}
        id={id}
        name={name}
        numberInputProps={{
          className:
            "w-full border-0 bg-transparent text-base text-black placeholder:text-zinc-400 focus:outline-none focus:ring-0",
        }}
      />
    </div>
  );
}
