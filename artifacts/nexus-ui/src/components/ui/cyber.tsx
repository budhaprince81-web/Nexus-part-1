import React from 'react';
import { cn } from '@/lib/utils';

export const CyberPanel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { glowing?: boolean }>(
  ({ className, glowing, ...props }, ref) => {
    return (
      <div 
        ref={ref} 
        className={cn("cyber-panel p-4 transition-all duration-300", glowing && "cyber-glow", className)} 
        {...props} 
      />
    );
  }
);
CyberPanel.displayName = 'CyberPanel';

export const CyberButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'success' | 'ghost' }>(
  ({ className, variant = 'primary', ...props }, ref) => {
    const base = "relative inline-flex items-center justify-center px-4 py-2 text-sm font-medium uppercase tracking-wider transition-all duration-200 outline-none disabled:opacity-50 disabled:pointer-events-none cursor-pointer";
    const variants = {
      primary: "bg-primary/10 text-primary border border-primary/50 hover:bg-primary/20 hover:border-primary hover:shadow-[0_0_15px_rgba(0,212,255,0.4)]",
      danger: "bg-destructive/10 text-destructive border border-destructive/50 hover:bg-destructive/20 hover:border-destructive hover:shadow-[0_0_15px_rgba(239,68,68,0.4)]",
      success: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/50 hover:bg-emerald-500/20 hover:border-emerald-500 hover:shadow-[0_0_15px_rgba(16,185,129,0.4)]",
      ghost: "text-muted-foreground hover:text-primary hover:bg-primary/5 border border-transparent"
    };
    
    return (
      <button ref={ref} className={cn(base, variants[variant], className)} {...props}>
        {props.children}
      </button>
    );
  }
);
CyberButton.displayName = 'CyberButton';

export const CyberInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input 
        ref={ref} 
        className={cn(
          "w-full bg-background/50 border border-primary/20 px-3 py-2 text-primary font-mono text-sm focus:outline-none focus:border-primary focus:shadow-[0_0_10px_rgba(0,212,255,0.2)] transition-all placeholder:text-primary/30",
          className
        )} 
        {...props} 
      />
    );
  }
);
CyberInput.displayName = 'CyberInput';

export const CyberBadge = ({ children, variant = 'info', className }: { children: React.ReactNode, variant?: 'info' | 'warning' | 'danger' | 'success', className?: string }) => {
  const variants = {
    info: "bg-primary/10 text-primary border-primary/30",
    warning: "bg-amber-500/10 text-amber-500 border-amber-500/30",
    danger: "bg-destructive/10 text-destructive border-destructive/30",
    success: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
  };
  return (
    <span className={cn("px-2 py-0.5 text-[10px] sm:text-xs font-mono border uppercase tracking-wider", variants[variant], className)}>
      {children}
    </span>
  );
};