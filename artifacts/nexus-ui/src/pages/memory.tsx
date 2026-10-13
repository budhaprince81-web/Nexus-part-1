import React, { useState } from 'react';
import { CyberPanel, CyberInput, CyberButton, CyberBadge } from '@/components/ui/cyber';
import { Search, Database, Trash2, Plus } from 'lucide-react';
import { 
  useSearchMemory, getSearchMemoryQueryKey,
  useStoreMemory, useDeleteMemory,
  useGetTelemetry, getGetTelemetryQueryKey
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

export default function Memory() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [content, setContent] = useState('');
  const [namespace, setNamespace] = useState('nexus');
  const [tags, setTags] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const { data: telemetry } = useGetTelemetry({ query: { queryKey: getGetTelemetryQueryKey() } });
  const { data: memories } = useSearchMemory(
    { q: search || '*' },
    { query: { queryKey: getSearchMemoryQueryKey({ q: search || '*' }) } }
  );

  const storeMem = useStoreMemory();
  const deleteMem = useDeleteMemory();

  const handleStore = (e: React.FormEvent) => {
    e.preventDefault();
    const tagArray = tags.split(',').map(t => t.trim()).filter(Boolean);
    storeMem.mutate({ data: { content, namespace, tags: tagArray } }, {
      onSuccess: () => {
        setContent('');
        setTags('');
        setShowAdd(false);
        queryClient.invalidateQueries({ queryKey: getSearchMemoryQueryKey({ q: search || '*' }) });
      }
    });
  };

  const handleDelete = (id: string) => {
    deleteMem.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getSearchMemoryQueryKey({ q: search || '*' }) });
      }
    });
  };

  return (
    <div className="h-full flex flex-col gap-6">
      <div className="flex shrink-0">
        <CyberPanel className="flex-1 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Database className="w-8 h-8 text-primary" />
            <div>
              <h2 className="font-mono text-xl text-primary tracking-widest uppercase">Semantic Databank</h2>
              <p className="font-mono text-xs text-primary/50 uppercase">Total Records: {telemetry?.memoryRecords || 0}</p>
            </div>
          </div>
          <CyberButton onClick={() => setShowAdd(!showAdd)} className="w-full sm:w-auto">
            {showAdd ? 'Cancel Store' : <><Plus className="w-4 h-4 mr-2" /> Store Memory</>}
          </CyberButton>
        </CyberPanel>
      </div>

      {showAdd && (
        <CyberPanel className="shrink-0 animate-in slide-in-from-top-4 fade-in duration-300">
          <form onSubmit={handleStore} className="grid gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-mono text-primary/70 uppercase">Namespace</label>
                <CyberInput value={namespace} onChange={e => setNamespace(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-mono text-primary/70 uppercase">Tags (comma separated)</label>
                <CyberInput value={tags} onChange={e => setTags(e.target.value)} placeholder="core, user_pref, task" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-mono text-primary/70 uppercase">Content</label>
              <textarea 
                className="w-full bg-background/50 border border-primary/20 p-3 text-primary font-mono text-sm focus:outline-none focus:border-primary h-32 custom-scrollbar focus:shadow-[0_0_10px_rgba(0,212,255,0.2)] transition-all"
                value={content}
                onChange={e => setContent(e.target.value)}
                required
                placeholder="Enter memory fragment data..."
              />
            </div>
            <div className="flex justify-end">
              <CyberButton type="submit" disabled={storeMem.isPending} className="w-full md:w-auto">
                {storeMem.isPending ? 'COMMITTING...' : 'COMMIT TO DATABANK'}
              </CyberButton>
            </div>
          </form>
        </CyberPanel>
      )}

      <CyberPanel className="flex-1 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-primary/20 shrink-0 relative">
          <Search className="w-5 h-5 text-primary/50 absolute left-7 top-1/2 -translate-y-1/2" />
          <CyberInput 
            className="pl-10 h-12 text-base md:text-lg"
            placeholder="QUERY MEMORY CORE..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 auto-rows-max relative z-10">
          {memories?.map(mem => (
            <div key={mem.id} className="border border-primary/20 bg-primary/5 p-4 relative group hover:border-primary/50 hover:bg-primary/10 transition-colors flex flex-col h-full shadow-sm hover:shadow-[0_0_15px_rgba(0,212,255,0.1)]">
              <div className="flex justify-between items-start mb-3 shrink-0">
                <CyberBadge variant="info">{mem.namespace}</CyberBadge>
                <button 
                  onClick={() => handleDelete(mem.id)} 
                  className="text-primary/40 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 p-1 rounded-sm border border-transparent hover:border-destructive/50"
                  title="Delete Memory"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <p className="font-mono text-sm text-primary/90 mb-4 whitespace-pre-wrap flex-1">{mem.content}</p>
              <div className="flex gap-2 flex-wrap mt-auto shrink-0">
                {mem.tags.map(t => (
                  <span key={t} className="text-[10px] font-mono border border-primary/20 bg-background/50 px-1.5 py-0.5 text-primary/70 uppercase">#{t}</span>
                ))}
              </div>
            </div>
          ))}
          {memories?.length === 0 && (
            <div className="col-span-full flex items-center justify-center h-48 font-mono text-primary/40 uppercase">
              No memory fragments found matching query.
            </div>
          )}
        </div>
      </CyberPanel>
    </div>
  );
}