import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** The shadcn-style class combiner the ui/ components expect. twMerge
 *  so a later class can override an earlier one (`px-3 px-6` resolves
 *  to px-6) instead of both shipping and the cascade deciding. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
