import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { Layout } from '@/components/layout';
import Dashboard from '@/pages/dashboard';
import Chat from '@/pages/chat';
import Memory from '@/pages/memory';
import Agents from '@/pages/agents';
import Sandbox from '@/pages/sandbox';
import Settings from '@/pages/settings';
import Vision from '@/pages/vision';
import Coding from '@/pages/coding';
import Tasks from '@/pages/tasks';
import Research from '@/pages/research';
import Trading from '@/pages/trading';
import { LangProvider } from '@/hooks/use-language';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5000,
    },
  },
});

function NotFound() {
  return (
    <div className="h-full flex items-center justify-center flex-col gap-4 font-mono relative">
      <div className="absolute inset-0 bg-destructive/5 pointer-events-none z-0" />
      <h1 className="text-3xl md:text-5xl text-destructive tracking-[0.2em] shadow-[0_0_15px_rgba(239,68,68,0.3)] p-6 border border-destructive relative z-10 bg-background/50 backdrop-blur">
        404 — SECTOR NOT FOUND
      </h1>
      <p className="text-primary/60 uppercase tracking-widest mt-4 relative z-10 text-center px-4">
        The requested coordinate does not exist in this sector.
      </p>
    </div>
  );
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/chat" component={Chat} />
        <Route path="/memory" component={Memory} />
        <Route path="/agents" component={Agents} />
        <Route path="/sandbox" component={Sandbox} />
        <Route path="/vision" component={Vision} />
        <Route path="/coding" component={Coding} />
        <Route path="/tasks" component={Tasks} />
        <Route path="/research" component={Research} />
        <Route path="/trading" component={Trading} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <LangProvider>
      <QueryClientProvider client={queryClient}>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
      </QueryClientProvider>
    </LangProvider>
  );
}

export default App;
