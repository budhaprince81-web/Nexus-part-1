import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X, CheckCircle, AlertTriangle, AlertCircle, Info, Zap, BotIcon, CheckSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useListNotifications, getListNotificationsQueryKey,
  useDismissNotification, useClearAllNotifications,
  useMarkNotificationRead
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

type NotificationType = 'info' | 'success' | 'warning' | 'error' | 'system' | 'agent' | 'task';

const icons: Record<NotificationType, React.ReactNode> = {
  info:    <Info className="w-4 h-4" />,
  success: <CheckCircle className="w-4 h-4" />,
  warning: <AlertTriangle className="w-4 h-4" />,
  error:   <AlertCircle className="w-4 h-4" />,
  system:  <Zap className="w-4 h-4" />,
  agent:   <BotIcon className="w-4 h-4" />,
  task:    <CheckSquare className="w-4 h-4" />,
};

const colors: Record<NotificationType, string> = {
  info:    'text-primary border-primary/30 bg-primary/5',
  success: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/5',
  warning: 'text-amber-400 border-amber-400/30 bg-amber-400/5',
  error:   'text-red-400 border-red-400/30 bg-red-400/5',
  system:  'text-violet-400 border-violet-400/30 bg-violet-400/5',
  agent:   'text-cyan-300 border-cyan-300/30 bg-cyan-300/5',
  task:    'text-emerald-300 border-emerald-300/30 bg-emerald-300/5',
};

export function NotificationsCenter() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data: notifications = [] } = useListNotifications(
    { limit: 30 },
    { query: { refetchInterval: 5000, queryKey: getListNotificationsQueryKey({ limit: 30 }) } }
  );

  const dismiss = useDismissNotification();
  const clearAll = useClearAllNotifications();
  const markRead = useMarkNotificationRead();

  const unread = notifications.filter(n => !n.read).length;

  const invalidate = () => qc.invalidateQueries({ queryKey: getListNotificationsQueryKey({ limit: 30 }) });

  const handleDismiss = (id: string) => {
    dismiss.mutate({ id }, { onSuccess: invalidate });
  };

  const handleClear = () => {
    clearAll.mutate(undefined, { onSuccess: invalidate });
  };

  const handleRead = (id: string) => {
    markRead.mutate({ id }, { onSuccess: invalidate });
  };

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        onClick={() => setOpen(p => !p)}
        className={cn(
          "relative flex items-center justify-center w-8 h-8 border transition-all duration-300",
          open ? "border-primary bg-primary/10 text-primary" : "border-primary/20 text-primary/50 hover:border-primary/50 hover:text-primary"
        )}
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-1 font-mono shadow-[0_0_8px_rgba(239,68,68,0.6)]"
          >
            {unread > 9 ? '9+' : unread}
          </motion.span>
        )}
      </button>

      {/* Dropdown panel */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-10 w-80 z-50 cyber-panel border border-primary/20 bg-background/95 backdrop-blur-xl shadow-[0_0_30px_rgba(0,212,255,0.15)]"
            >
              {/* Header */}
              <div className="flex items-center justify-between p-3 border-b border-primary/15">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-primary" />
                  <span className="font-mono text-xs uppercase tracking-widest text-primary">Notifications</span>
                  {unread > 0 && (
                    <span className="text-[10px] font-mono text-primary/60 bg-primary/10 border border-primary/20 px-1.5 py-0.5">
                      {unread} NEW
                    </span>
                  )}
                </div>
                {notifications.length > 0 && (
                  <button
                    onClick={handleClear}
                    className="text-primary/40 hover:text-destructive transition-colors font-mono text-[10px] uppercase"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {/* List */}
              <div className="max-h-80 overflow-y-auto custom-scrollbar">
                {notifications.length === 0 ? (
                  <div className="p-6 text-center font-mono text-primary/30 text-xs uppercase">
                    No notifications
                  </div>
                ) : (
                  <AnimatePresence>
                    {notifications.map(n => {
                      const type = (n.type as NotificationType) || 'info';
                      return (
                        <motion.div
                          key={n.id}
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className={cn(
                            "flex gap-3 p-3 border-b border-primary/5 cursor-pointer hover:bg-primary/5 transition-colors relative",
                            !n.read && "bg-primary/3"
                          )}
                          onClick={() => handleRead(n.id)}
                        >
                          {!n.read && (
                            <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary" />
                          )}
                          <div className={cn("shrink-0 mt-0.5", colors[type].split(' ')[0])}>
                            {icons[type]}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-mono text-xs font-bold text-primary/90 truncate">{n.title}</div>
                            <div className="font-mono text-[10px] text-primary/60 mt-0.5 leading-relaxed">{n.message}</div>
                            <div className="font-mono text-[9px] text-primary/30 mt-1">
                              {new Date(n.createdAt).toLocaleTimeString()}
                            </div>
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); handleDismiss(n.id); }}
                            className="shrink-0 text-primary/20 hover:text-destructive transition-colors mt-0.5"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
