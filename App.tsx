
import React, { useState, useCallback, useRef } from 'react';
import JSZip from 'jszip';
import { 
  Wrench, Search, Globe, Scissors, Scale, Eye, 
  Upload, Folder, Trash2, Download, FileText, 
  CheckCircle, AlertCircle, ChevronRight, Menu
} from 'lucide-react';
import { ProcessedFile, TabId, LogEntry, HierarchySkip } from './types';

const App: React.FC = () => {
  const [loadedFiles, setLoadedFiles] = useState<ProcessedFile[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>('process');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Form States
  const [mergeSrc, setMergeSrc] = useState('h4');
  const [mergeTarget, setMergeTarget] = useState('h5');
  const [mergeExclude, setMergeExclude] = useState('');
  
  const [splitTag, setSplitTag] = useState('h2');
  const [splitBookName, setSplitBookName] = useState('');
  const [splitAuthor, setSplitAuthor] = useState('');
  const [splitExclude, setSplitExclude] = useState('');

  const [repScope, setRepScope] = useState('all');
  const [repFind, setRepFind] = useState('');
  const [repWith, setRepWith] = useState('');

  const [globalFind, setGlobalFind] = useState('');
  const [globalReplace, setGlobalReplace] = useState('');

  const [hierSkip, setHierSkip] = useState<HierarchySkip>({ h1: false, h2: false, h3: false });
  const [previewIdx, setPreviewIdx] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [{
      timestamp: new Date().toLocaleTimeString(),
      message,
      type
    }, ...prev].slice(0, 50));
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const newFiles: ProcessedFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const content = await f.text();
      newFiles.push({ 
        name: f.name.replace(/\.[^/.]+$/, ""), 
        content: content,
        originalName: f.name
      });
    }
    setLoadedFiles(prev => [...prev, ...newFiles]);
    addLog(`נטענו ${files.length} קבצים.`, 'success');
  };

  const checkEx = (text: string, exStr: string) => {
    if (!exStr || !exStr.trim()) return false;
    const words = exStr.split(',').map(w => w.trim().toLowerCase()).filter(w => w);
    return words.some(w => text.toLowerCase().includes(w));
  };

  const cleanName = (n: string, i: number) => {
    return n.replace(/[\\/:*?"<>|]/g, "").substring(0, 80) || `file_${i}`;
  };

  // Logic Implementations
  const applyMerge = () => {
    setLoadedFiles(prev => prev.map(f => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(f.content, 'text/html');
      let currentSourceText = "";
      let toDel: Element[] = [];
      
      doc.body.querySelectorAll('*').forEach(el => {
        const tagName = el.tagName.toLowerCase();
        if (tagName === mergeSrc) {
          currentSourceText = el.textContent?.trim() || "";
          toDel.push(el);
        } else if (tagName === mergeTarget) {
          if (currentSourceText && !checkEx(el.textContent || "", mergeExclude)) {
            el.innerHTML = `${currentSourceText} ${el.innerHTML}`;
          }
        }
      });
      
      toDel.forEach(el => {
        // Remove trailing newline text nodes to prevent empty lines
        const next = el.nextSibling;
        if (next && next.nodeType === 3 && !next.textContent?.trim()) {
           next.remove();
        }
        el.remove();
      });
      
      return { ...f, content: doc.body.innerHTML };
    }));
    addLog("חיבור כותרות בוצע.", 'success');
  };

  const applyGlobalReplace = () => {
    if (!globalFind) return;
    const regex = new RegExp(globalFind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    setLoadedFiles(prev => prev.map(f => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(f.content, 'text/html');
      doc.body.querySelectorAll('*').forEach(el => {
        if (el.children.length === 0 && el.textContent?.trim() !== "") {
          el.innerHTML = el.innerHTML.replace(regex, globalReplace);
        }
      });
      return { ...f, content: doc.body.innerHTML };
    }));
    addLog("החלפה גלובלית בוצעה.", 'success');
  };

  const applySplit = () => {
    let newFiles: ProcessedFile[] = [];
    loadedFiles.forEach(f => {
      const parts = f.content.split(new RegExp(`(<${splitTag}[^>]*>.*?</${splitTag}>)`, 'gi'));
      let currentContent = "", currentTitle = f.name, idx = 0;
      
      parts.forEach(part => {
        if (part.toLowerCase().startsWith(`<${splitTag}`) && !checkEx(part, splitExclude)) {
          if (currentContent.trim()) {
            newFiles.push({ name: cleanName(currentTitle, idx), content: currentContent.trim() });
          }
          
          const tempDiv = document.createElement('div'); 
          tempDiv.innerHTML = part;
          const originalTitleText = tempDiv.textContent?.trim() || "";
          
          if (splitBookName) {
            const headerMatch = part.match(/<h[1-6][^>]*>/i);
            const openTag = headerMatch ? headerMatch[0] : `<${splitTag}>`;
            const closeTag = `</${splitTag}>`;
            currentContent = `${openTag}${splitBookName} ${originalTitleText}${closeTag}`;
          } else {
            currentContent = part;
          }

          currentTitle = (splitBookName ? splitBookName + " " : "") + (originalTitleText || f.name);
          if (splitAuthor) currentContent += `\n<p>${splitAuthor}</p>`;
          idx++;
        } else { 
          currentContent += part; 
        }
      });
      if (currentContent.trim()) {
        newFiles.push({ name: cleanName(currentTitle, idx), content: currentContent.trim() });
      }
    });
    setLoadedFiles(newFiles);
    addLog(`חיתוך בוצע. נוצרו ${newFiles.length} קבצים.`, 'success');
  };

  const applyReplaceHeaders = () => {
    if (!repFind) return;
    const regex = new RegExp(repFind, 'g');
    setLoadedFiles(prev => prev.map(f => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(f.content, 'text/html');
      const selector = repScope === 'all' ? 'h1,h2,h3,h4,h5,h6' : repScope;
      doc.body.querySelectorAll(selector).forEach(el => {
        el.innerHTML = el.innerHTML.replace(regex, repWith);
      });
      return { ...f, content: doc.body.innerHTML };
    }));
    addLog("החלפה בכותרות בוצעה.", 'success');
  };

  const applyFixHierarchy = () => {
    const skipTags = Object.entries(hierSkip).filter(([_, v]) => v).map(([k]) => k);
    setLoadedFiles(prev => prev.map(f => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(f.content, 'text/html');
      const headers = Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      
      let found: string[] = [];
      headers.forEach(h => {
        const tag = h.tagName.toLowerCase();
        if(!skipTags.includes(tag)) found.push(tag);
      });
      
      found = [...new Set(found)].sort();
      const map: Record<string, string> = {};
      found.forEach((t, i) => map[t] = 'h' + (i + 1));
      
      headers.forEach(h => {
        const oldTag = h.tagName.toLowerCase();
        if(map[oldTag]) {
          const newHeader = doc.createElement(map[oldTag]);
          newHeader.innerHTML = h.innerHTML;
          h.replaceWith(newHeader);
        }
      });
      return { ...f, content: doc.body.innerHTML };
    }));
    addLog("נירמול היררכיה בוצע.", 'success');
  };

  const downloadAll = async () => {
    if (loadedFiles.length === 0) return;
    const zip = new JSZip();
    loadedFiles.forEach(f => {
      zip.file(`${f.name}.txt`, f.content);
    });
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Otzaria_Output_${new Date().toISOString().split('T')[0]}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addLog("הקובץ מוכן להורדה.", 'success');
  };

  const NavButton = ({ id, icon: Icon, label }: { id: TabId, icon: any, label: string }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 text-right ${
        activeTab === id 
          ? 'bg-blue-600 text-white shadow-lg shadow-blue-200 translate-x-1' 
          : 'text-slate-600 hover:bg-blue-50 hover:text-blue-600'
      }`}
    >
      <Icon size={18} />
      <span className="font-semibold text-sm">{label}</span>
    </button>
  );

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden" dir="rtl">
      {/* Hidden File Inputs */}
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      {/* 
          Fix: Use a spread object with 'as any' to bypass TypeScript checking for non-standard 'webkitdirectory' and 'directory' attributes 
      */}
      <input 
        ref={folderInputRef} 
        type="file" 
        {...({ webkitdirectory: "", directory: "" } as any)} 
        multiple 
        className="hidden" 
        onChange={(e) => handleFiles(e.target.files)} 
      />

      {/* Sidebar */}
      <aside className={`bg-white border-l border-slate-200 transition-all duration-300 flex flex-col ${isSidebarOpen ? 'w-72' : 'w-0 overflow-hidden'}`}>
        <div className="p-6 border-b border-slate-100 flex items-center gap-2">
          <div className="p-2 bg-blue-600 rounded-lg text-white">
            <Wrench size={24} />
          </div>
          <h1 className="text-xl font-bold text-slate-800">מעבד Otzaria</h1>
        </div>
        
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <NavButton id="process" icon={Wrench} label="חיבור כותרות (Merge)" />
          <NavButton id="replace" icon={Search} label="החלפה בכותרות" />
          <NavButton id="global" icon={Globe} label="החלפה גלובלית" />
          <NavButton id="split" icon={Scissors} label="חיתוך מסמך" />
          <NavButton id="fix" icon={Scale} label="נירמול היררכיה" />
          <NavButton id="preview" icon={Eye} label="תצוגה מקדימה" />
        </nav>

        <div className="p-4 border-t border-slate-100">
           <div className="text-xs text-slate-400 text-center">v2.0 - Optimized for Otzaria</div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600">
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm font-medium">
              <FileText size={14} />
              <span>{loadedFiles.length} קבצים</span>
            </div>
          </div>
          
          <div className="flex gap-2">
             <button 
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg transition-colors text-sm font-bold"
              >
                <FileText size={16} />
                טען קבצים
              </button>
              <button 
                onClick={() => folderInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg transition-colors text-sm font-bold"
              >
                <Folder size={16} />
                טען תיקייה
              </button>
             <button 
                onClick={() => setLoadedFiles([])}
                className="flex items-center gap-2 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors text-sm font-bold mr-2"
              >
                <Trash2 size={16} />
                נקה הכל
              </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 pb-32">
          {/* Dynamic Tabs */}
          <div className="space-y-6">
            {activeTab === 'process' && (
              <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm animate-in fade-in duration-300">
                <h3 className="text-xl font-bold mb-6 text-slate-800 flex items-center gap-2">
                  <Wrench className="text-blue-500" /> חיבור כותרות (Merge)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">מקור (Tag to Merge):</label>
                    <select value={mergeSrc} onChange={e => setMergeSrc(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500">
                      {['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(h => <option key={h} value={h}>{h.toUpperCase()}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">יעד (Target Header):</label>
                    <select value={mergeTarget} onChange={e => setMergeTarget(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500">
                      {['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(h => <option key={h} value={h}>{h.toUpperCase()}</option>)}
                    </select>
                  </div>
                </div>
                <div className="p-4 bg-orange-50 border border-orange-100 rounded-xl mb-6">
                  <label className="block text-sm font-bold text-orange-800 mb-2">החרג יעד המכיל (פסיק להפרדה):</label>
                  <input 
                    type="text" 
                    value={mergeExclude}
                    onChange={e => setMergeExclude(e.target.value)}
                    placeholder="מילה1, מילה2..." 
                    className="w-full p-3 bg-white border border-orange-200 rounded-lg outline-none focus:ring-2 focus:ring-orange-500"
                  />
                </div>
                <button onClick={applyMerge} className="w-full py-4 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-900 transition-all shadow-lg">בצע חיבור</button>
              </div>
            )}

            {activeTab === 'replace' && (
              <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm animate-in fade-in duration-300">
                <h3 className="text-xl font-bold mb-6 text-slate-800 flex items-center gap-2">
                  <Search className="text-blue-500" /> החלפה בכותרות
                </h3>
                <div className="grid grid-cols-1 gap-6 mb-6">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">החל על:</label>
                    <select value={repScope} onChange={e => setRepScope(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl">
                      <option value="all">כל הכותרות</option>
                      {['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(h => <option key={h} value={h}>{h.toUpperCase()}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">חפש (Regex תומך):</label>
                      <input type="text" value={repFind} onChange={e => setRepFind(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl" />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">החלף ב:</label>
                      <input type="text" value={repWith} onChange={e => setRepWith(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl" />
                    </div>
                  </div>
                </div>
                <button onClick={applyReplaceHeaders} className="w-full py-4 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-900 transition-all shadow-lg">בצע החלפה</button>
              </div>
            )}

            {activeTab === 'global' && (
              <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm animate-in fade-in duration-300">
                <h3 className="text-xl font-bold mb-6 text-slate-800 flex items-center gap-2">
                  <Globe className="text-blue-500" /> החלפה גלובלית בטקסט
                </h3>
                <div className="space-y-6 mb-6">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">חפש טקסט:</label>
                    <textarea value={globalFind} onChange={e => setGlobalFind(e.target.value)} rows={3} className="w-full p-4 border border-slate-200 rounded-xl resize-none outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">החלף בטקסט:</label>
                    <textarea value={globalReplace} onChange={e => setGlobalReplace(e.target.value)} rows={3} className="w-full p-4 border border-slate-200 rounded-xl resize-none outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <button onClick={applyGlobalReplace} className="w-full py-4 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-900 transition-all shadow-lg">בצע החלפה גלובלית</button>
              </div>
            )}

            {activeTab === 'split' && (
              <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm animate-in fade-in duration-300">
                <h3 className="text-xl font-bold mb-6 text-slate-800 flex items-center gap-2">
                  <Scissors className="text-blue-500" /> חיתוך מסמך לקבצים נפרדים
                </h3>
                <div className="space-y-6 mb-6">
                  <div className="w-full">
                    <label className="block text-sm font-bold text-slate-700 mb-2">חתוך בכל (Tag):</label>
                    <select value={splitTag} onChange={e => setSplitTag(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl">
                      {['h1', 'h2', 'h3', 'h4'].map(h => <option key={h} value={h}>{h.toUpperCase()}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">שם המחבר להוספה:</label>
                      <input type="text" value={splitAuthor} onChange={e => setSplitAuthor(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl" />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-700 mb-2">שם הספר להוספה לכותרת:</label>
                      <input type="text" value={splitBookName} onChange={e => setSplitBookName(e.target.value)} placeholder="לדוגמה: יד דוד על..." className="w-full p-3 border border-slate-200 rounded-xl" />
                    </div>
                  </div>
                  <div className="w-full">
                    <label className="block text-sm font-bold text-slate-700 mb-2">אל תחתוך אם הכותרת מכילה:</label>
                    <input type="text" value={splitExclude} onChange={e => setSplitExclude(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl" />
                  </div>
                </div>
                <button onClick={applySplit} className="w-full py-4 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-900 transition-all shadow-lg">בצע חיתוך מסמך</button>
              </div>
            )}

            {activeTab === 'fix' && (
              <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm animate-in fade-in duration-300">
                <h3 className="text-xl font-bold mb-6 text-slate-800 flex items-center gap-2">
                  <Scale className="text-blue-500" /> נירמול היררכיה (Normalization)
                </h3>
                <div className="p-6 bg-blue-50 border border-blue-100 rounded-2xl mb-6">
                  <span className="text-sm font-bold text-blue-800 block mb-4">החרג רמות (לא ישתתפו בסידור מחדש):</span>
                  <div className="flex gap-6">
                    {['h1', 'h2', 'h3'].map(h => (
                      <label key={h} className="flex items-center gap-3 cursor-pointer group">
                        <input 
                          type="checkbox" 
                          checked={hierSkip[h as keyof HierarchySkip]} 
                          onChange={e => setHierSkip(prev => ({ ...prev, [h]: e.target.checked }))}
                          className="w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500" 
                        />
                        <span className="font-bold text-slate-700 group-hover:text-blue-600 uppercase">{h}</span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-4 text-xs text-blue-600 font-medium">* הנירמול יסדר מחדש את כל הכותרות הנותרות לרצף לוגי (h1, h2, h3...)</p>
                </div>
                <button onClick={applyFixHierarchy} className="w-full py-4 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-900 transition-all shadow-lg">בצע נירמול</button>
              </div>
            )}

            {activeTab === 'preview' && (
              <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm animate-in fade-in duration-300">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <Eye className="text-blue-500" /> תצוגה מקדימה
                  </h3>
                  <select 
                    value={previewIdx} 
                    onChange={e => setPreviewIdx(Number(e.target.value))}
                    className="p-2 border border-slate-200 rounded-lg text-sm"
                  >
                    {loadedFiles.map((f, i) => <option key={i} value={i}>{f.name}</option>)}
                  </select>
                </div>
                <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 min-h-[400px] max-h-[60vh] overflow-auto whitespace-pre-wrap font-mono text-sm leading-relaxed text-slate-700" dir="rtl">
                  {loadedFiles[previewIdx]?.content || 'אין קבצים לתצוגה'}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Action Bar (Sticky Footer) */}
        <footer className="bg-white border-t border-slate-200 px-8 py-6 flex items-center gap-8 fixed bottom-0 left-0 right-0 z-20 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]" style={{ right: isSidebarOpen ? '288px' : '0' }}>
          <div className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 h-20 overflow-y-auto">
            {logs.length === 0 ? (
              <div className="text-slate-400 text-xs mt-2 italic">ממתין לפעולות...</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className={`text-xs mb-1 flex items-center gap-2 ${
                  log.type === 'success' ? 'text-green-600' : 
                  log.type === 'error' ? 'text-red-600' : 'text-slate-500'
                }`}>
                  <span className="font-mono text-[10px] opacity-60">[{log.timestamp}]</span>
                  <span className="font-medium">{log.message}</span>
                </div>
              ))
            )}
          </div>
          
          <button 
            disabled={loadedFiles.length === 0}
            onClick={downloadAll}
            className={`flex items-center gap-3 px-8 py-4 rounded-2xl font-bold text-white transition-all shadow-xl shadow-blue-200 ${
              loadedFiles.length === 0 ? 'bg-slate-300' : 'bg-blue-600 hover:bg-blue-700 hover:scale-105 active:scale-95'
            }`}
          >
            <Download size={22} />
            הורד הכל ב-ZIP
          </button>
        </footer>
      </main>
    </div>
  );
};

export default App;
