import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { X } from "lucide-react";
import { forwardRef, useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

// ---- Button ----

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary: "bg-ember text-bg hover:bg-ember-soft font-semibold",
  secondary: "bg-bg-active text-ink hover:bg-bg-hover border border-border-strong",
  outline: "border border-border text-ink hover:bg-bg-hover",
  ghost: "text-ink-muted hover:bg-bg-hover hover:text-ink",
  danger: "bg-blood/80 text-ink hover:bg-blood",
};
const sizes: Record<Size, string> = {
  sm: "h-7 px-2 text-[12px] gap-1",
  md: "h-8 px-3 text-[13px] gap-1.5",
  icon: "h-7 w-7 justify-center",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant = "secondary", size = "md", type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn("inline-flex shrink-0 items-center rounded transition-colors disabled:opacity-50", variants[variant], sizes[size], className)}
      {...props}
    />
  );
});

// ---- Inputs ----

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn("input", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn("input min-h-[80px] resize-y font-sans leading-relaxed", className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn("input appearance-none bg-bg pr-6", className)} {...props}>
      {children}
    </select>
  );
});

export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-ink-faint">{hint}</span>}
    </label>
  );
}

export function Checkbox({ label, checked, onChange, className }: { label: string; checked: boolean; onChange: (v: boolean) => void; className?: string }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-[13px]", className)}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-ember" />
      {label}
    </label>
  );
}

// ---- Badge / chips ----

export function Badge({ children, tone = "default", className }: { children: ReactNode; tone?: "default" | "ember" | "moss" | "blood" | "water" | "violet" | "gold"; className?: string }) {
  const tones = {
    default: "border-border text-ink-muted",
    ember: "border-ember/50 text-ember-soft",
    moss: "border-moss/50 text-moss",
    blood: "border-blood/60 text-blood",
    water: "border-water/60 text-water",
    violet: "border-violet/60 text-violet",
    gold: "border-gold/60 text-gold",
  };
  return <span className={cn("inline-flex items-center rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide", tones[tone], className)}>{children}</span>;
}

// ---- Dialog ----

export function Dialog({ open, onOpenChange, title, description, children, footer, width = "max-w-lg" }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children?: ReactNode; footer?: ReactNode; width?: string }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <DialogPrimitive.Content className={cn("fixed left-1/2 top-1/2 z-50 w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-strong bg-bg-elevated p-5 shadow-2xl focus:outline-none", width)}>
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <DialogPrimitive.Title className="font-display text-lg text-ember-soft">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="mt-1 text-[12px] text-ink-muted">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X size={14} />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="max-h-[70vh] overflow-y-auto pr-1">{children}</div>
          {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function ConfirmDialog({ open, onOpenChange, title, body, confirmLabel = "Delete", danger = true, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-ink-muted">{body}</div>
    </Dialog>
  );
}

// ---- Tooltip ----

export function Tooltip({ children, content, side = "bottom" }: { children: ReactNode; content: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipPrimitive.Root delayDuration={400}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6} className="z-50 rounded border border-border-strong bg-bg-elevated px-2 py-1 text-[11px] text-ink shadow-lg">
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;

// ---- Tabs ----

export function Tabs({ value, onValueChange, tabs, children, className }: { value: string; onValueChange: (v: string) => void; tabs: { value: string; label: ReactNode }[]; children: ReactNode; className?: string }) {
  return (
    <TabsPrimitive.Root value={value} onValueChange={onValueChange} className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <TabsPrimitive.List className="flex shrink-0 gap-1 border-b border-border px-1">
        {tabs.map((t) => (
          <TabsPrimitive.Trigger
            key={t.value}
            value={t.value}
            className="-mb-px border-b-2 border-transparent px-2.5 py-1.5 text-[12px] font-medium text-ink-muted hover:text-ink data-[state=active]:border-ember data-[state=active]:text-ember-soft"
          >
            {t.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {children}
    </TabsPrimitive.Root>
  );
}

export function TabPanel({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <TabsPrimitive.Content value={value} className={cn("min-h-0 flex-1 overflow-y-auto p-3 focus:outline-none", className)}>
      {children}
    </TabsPrimitive.Content>
  );
}

// ---- Layout helpers ----

export function Panel({ title, actions, children, className, bodyClassName }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("panel flex min-h-0 flex-col", className)}>
      {title !== undefined && (
        <header className="panel-title">
          <span>{title}</span>
          {actions && <span className="flex items-center gap-1 normal-case tracking-normal">{actions}</span>}
        </header>
      )}
      <div className={cn("min-h-0 flex-1 overflow-y-auto p-3", bodyClassName)}>{children}</div>
    </section>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="font-display text-lg text-ink-muted">{title}</div>
      {body && <div className="max-w-sm text-[12px] text-ink-faint">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex shrink-0 flex-col gap-2 border-b border-border bg-bg-elevated px-4 py-2.5">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-lg leading-tight text-ember-soft">{title}</h1>
          {subtitle && <div className="truncate text-[12px] text-ink-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

/** Horizontal resizable split: left fixed-width pane with a drag handle. */
export function SplitPane({ left, right, width, onWidthChange, min = 200, max = 640, className }: { left: ReactNode; right: ReactNode; width: number; onWidthChange: (w: number) => void; min?: number; max?: number; className?: string }) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(width);
  const onMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current) return;
      onWidthChange(Math.min(max, Math.max(min, startW.current + e.clientX - startX.current)));
    },
    [max, min, onWidthChange],
  );
  useEffect(() => {
    const up = () => {
      dragging.current = false;
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
    };
  }, [onMove]);
  return (
    <div className={cn("flex min-h-0 flex-1", className)}>
      <div style={{ width }} className="flex min-h-0 shrink-0 flex-col border-r border-border bg-bg-elevated">
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-ember/40"
        onPointerDown={(e) => {
          dragging.current = true;
          startX.current = e.clientX;
          startW.current = width;
          document.body.style.cursor = "col-resize";
        }}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{right}</div>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border-strong bg-bg px-1 font-mono text-[10px] text-ink-muted">{children}</kbd>;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink-faint border-t-ember", className)} />;
}
