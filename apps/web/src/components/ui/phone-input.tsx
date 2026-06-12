"use client";

/**
 * PWA checkout — international phone input.
 *
 * Wraps `react-phone-number-input`'s headless `<PhoneInput>` with our own
 * shadcn primitives (the well-known shadcn "phone-input" pattern):
 *  - a country-select dropdown (flag + dial code) on the left, built from
 *    `Popover` + `Command` + `Button` + `ScrollArea`,
 *  - the existing `Input` for the national number part.
 *
 * The value is the **E.164** string (e.g. `+33612345678`) — exactly what
 * Uber Direct's Create Delivery expects for `dropoff_phone_number`. The
 * national-format-as-you-type and per-country validation come from
 * `libphonenumber-js` under the hood; final validity is asserted by the pure
 * `decideContactFormValid` (so the « Payer » CTA stays disabled on junk).
 *
 * `react-phone-number-input/style.css` is imported once for the base flexbox
 * layout (`.PhoneInput`, `.PhoneInputInput`, …); the visual skin (emerald
 * focus ring, rounded-lg, h-10) is our Tailwind, matching the sibling
 * firstName / email inputs in `<CheckoutForm>`.
 */

import * as React from "react";
import RPNInput, {
  type Country,
  type FlagProps,
  getCountryCallingCode,
} from "react-phone-number-input";
import flags from "react-phone-number-input/flags";
import frLabels from "react-phone-number-input/locale/fr.json";
import "react-phone-number-input/style.css";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Emerald focus skin shared by the number field AND the country trigger so
 * both halves of the control light up identically (matches the sibling
 * firstName / email inputs in `<CheckoutForm>`).
 */
const FOCUS_CLASS =
  "focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-200";

/** Shared skin for the number field (matches sibling inputs). */
const FIELD_CLASS = cn(
  "h-10 rounded-lg border border-zinc-300 text-base text-black",
  FOCUS_CLASS,
);

type PhoneInputProps = Omit<
  React.ComponentProps<"input">,
  "onChange" | "value" | "ref"
> &
  Omit<React.ComponentProps<typeof RPNInput>, "onChange"> & {
    /** Fires with the E.164 string, or `""` when the field is cleared. */
    onChange?: (value: string) => void;
  };

/**
 * The KitchenBoost phone input. `value` / `onChange` are the controlled
 * E.164 contract; `onChange` always receives a string (`""` when cleared),
 * so the caller never has to handle `undefined`.
 */
const PhoneInput = React.forwardRef<
  React.ElementRef<typeof RPNInput>,
  PhoneInputProps
>(function PhoneInput({ className, onChange, ...props }, ref) {
  return (
    <RPNInput
      ref={ref}
      className={cn("flex items-center gap-2", className)}
      flagComponent={FlagComponent}
      countrySelectComponent={CountrySelect}
      inputComponent={NumberInput}
      labels={frLabels}
      // `react-phone-number-input` calls `onChange(undefined)` when the field
      // is empty; normalise to "" so the controlled contact state stays a
      // plain string (decideContactFormValid trims it to invalid).
      onChange={(value) => onChange?.(value ?? "")}
      {...props}
    />
  );
});

/** The national-number text field — the existing shadcn `<Input>`, skinned. */
const NumberInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>(function NumberInput({ className, ...props }, ref) {
  return (
    <Input
      ref={ref}
      // `rounded-s-none` so it visually fuses with the country trigger on its
      // left (the trigger owns the left rounding).
      className={cn(FIELD_CLASS, "rounded-s-none", className)}
      {...props}
    />
  );
});

type CountrySelectProps = {
  disabled?: boolean;
  value?: Country;
  onChange: (value: Country) => void;
  options: { label: string; value?: Country }[];
};

/**
 * Country dropdown : flag + `ChevronsUpDown` trigger → `Popover` with a
 * searchable `Command` list (flag + name + `+dial`). Uses the existing
 * `Popover` (which portals correctly on mobile) so the list escapes the
 * checkout card's overflow.
 */
function CountrySelect({
  disabled,
  value,
  onChange,
  options,
}: CountrySelectProps): React.JSX.Element {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          // Match the field height; own the left rounding; flush right with
          // the number input.
          className={cn(
            "flex h-10 gap-1 rounded-e-none rounded-s-lg border-zinc-300 px-3",
            FOCUS_CLASS,
          )}
          disabled={disabled}
          aria-label="Choisir l'indicatif pays"
        >
          <FlagComponent country={value as Country} countryName={value ?? ""} />
          <ChevronsUpDownIcon
            className={cn(
              "size-4 shrink-0 opacity-50",
              disabled ? "hidden" : "opacity-100",
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0">
        <Command>
          <CommandInput placeholder="Rechercher un pays…" />
          <CommandList>
            <ScrollArea className="h-72">
              <CommandEmpty>Aucun pays trouvé.</CommandEmpty>
              <CommandGroup>
                {options
                  .filter((x) => x.value)
                  .map((option) => (
                    <CommandItem
                      key={option.value}
                      // Search by name (e.g. "France") — value carries the
                      // ISO country for the CheckIcon match.
                      value={option.label}
                      onSelect={() => onChange(option.value as Country)}
                      className="gap-2"
                    >
                      <FlagComponent
                        country={option.value as Country}
                        countryName={option.label}
                      />
                      <span className="flex-1 text-sm">{option.label}</span>
                      <span className="text-sm text-zinc-500">
                        +{getCountryCallingCode(option.value as Country)}
                      </span>
                      <CheckIcon
                        className={cn(
                          "ml-auto size-4",
                          option.value === value ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  ))}
              </CommandGroup>
            </ScrollArea>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Renders the bundled SVG flag for a country (falls back to nothing). */
function FlagComponent({ country, countryName }: FlagProps): React.JSX.Element {
  const Flag = flags[country];
  return (
    <span className="flex h-4 w-6 shrink-0 overflow-hidden rounded-sm bg-zinc-100">
      {Flag ? <Flag title={countryName} /> : null}
    </span>
  );
}

export { PhoneInput };
