import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "btn inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[0.8125rem] font-medium tracking-[-0.005em] transition-[background-color,border-color,color,transform] duration-200 ease-out [&:not(:disabled)]:active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:saturate-50 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground border border-transparent font-semibold [&:not(:disabled)]:hover:bg-primary/88",
        destructive:
          "bg-transparent text-destructive border border-destructive/35 [&:not(:disabled)]:hover:bg-destructive/10",
        outline:
          "border [border-color:var(--line-strong)] [&:not(:disabled)]:hover:bg-foreground/[0.05]",
        secondary: "bg-transparent text-foreground border [border-color:var(--line-strong)] [&:not(:disabled)]:hover:bg-foreground/[0.05]",
        // Add a transparent border so that when someone toggles a border on later, it doesn't shift layout/size.
        ghost: "border border-transparent [&:not(:disabled)]:hover:bg-foreground/[0.05]",
      },
      // Heights are set as "min" heights, because sometimes Ai will place large amount of content
      // inside buttons. With a min-height they will look appropriate with small amounts of content,
      // but will expand to fit large amounts of content.
      size: {
        default: "min-h-9 px-4 py-1.5",
        sm: "min-h-8 px-3.5 text-xs",
        lg: "min-h-11 px-6 text-sm",
        icon: "btn-icon h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
