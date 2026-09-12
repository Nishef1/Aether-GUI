import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer relative inline-flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        "before:absolute before:h-5 before:w-9 before:rounded-full before:bg-surface-4 before:ring-1 before:ring-white/8 before:transition-colors before:duration-150 data-[state=checked]:before:bg-primary/85 data-[state=checked]:before:ring-primary/35",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none absolute left-2 block size-4 rounded-full bg-foreground shadow transition-transform duration-150 data-[state=checked]:translate-x-4 data-[state=checked]:bg-primary-foreground"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
