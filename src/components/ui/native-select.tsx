import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

interface NativeSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  containerClassName?: string;
}

export function NativeSelect({
  className,
  containerClassName,
  children,
  ...props
}: NativeSelectProps) {
  return (
    <span className={cn("relative block min-w-0 max-w-full", containerClassName)}>
      <select
        className={cn(
          "block min-h-12 w-full min-w-0 max-w-full appearance-none truncate rounded-xl bg-black/20 py-2 pr-10 pl-3 text-xs text-foreground ring-1 ring-white/10 outline-none transition focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}
