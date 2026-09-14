import { ParkButton, ParkEmptyState, ParkInput, ParkSelect } from '@luminatick/ui/park';
import React, { useState, useEffect, useId, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { dashboardApi } from '../api/client';
import { KnowledgeCategory } from '../types';
import { TiptapMarkdownField } from '../components/RichComposer';
import { ArrowLeft, FloppyDisk, SpinnerGap } from '@phosphor-icons/react';

export const KnowledgeEditorPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const titleId = useId();
  const categoryIdInput = useId();
  const tierId = useId();
  const contentId = useId();
  const errorId = useId();
  const routeKey = id ?? '__new__';
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const routeRef = useRef(id);
  const saveRequestRef = useRef(0);

  const [loadedRouteKey, setLoadedRouteKey] = useState<string | null>(id ? null : routeKey);
  const editorReady = routeRef.current === id && loadedRouteKey === routeKey;

  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState<string>(searchParams.get('categoryId') || '');
  const [tier, setTier] = useState<'answer' | 'sop'>('answer');
  const [content, setContent] = useState<string>('');

  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    routeRef.current = id;
    saveRequestRef.current += 1;
    savingRef.current = false;
    setIsSaving(false);
    setLoadedRouteKey(null);
    setError(null);
    setTitle('');
    setCategoryId(searchParams.get('categoryId') || '');
    setTier('answer');
    setContent('');
    if (!id) setLoadedRouteKey(routeKey);
  }, [id, routeKey]);

  useEffect(() => {
    let current = true;
    const fetchCategories = async () => {
      try {
        const cats = await dashboardApi.get<KnowledgeCategory[]>('/knowledge/categories');
        if (current) setCategories(cats);
      } catch (err: any) {
        if (current) setError(err.message);
      }
    };
    fetchCategories();
    return () => { current = false; };
  }, []);

  useEffect(() => {
    let current = true;
    if (id) {
      const fetchArticle = async () => {
        try {
          const [doc, articleContent] = await Promise.all([
            dashboardApi.get<any>(`/knowledge/articles/${id}`),
            dashboardApi.get<any>(`/knowledge/articles/${id}/content`),
          ]);
          if (!current) return;
          setTitle(doc.title);
          setCategoryId(doc.category_id || '');
          setTier(doc.tier || 'answer');
          setContent(articleContent.content || articleContent || '');
          setLoadedRouteKey(routeKey);
        } catch (err: any) {
          if (current) setError(err.message);
        }
      };
      fetchArticle();
    }
    return () => { current = false; };
  }, [id, routeKey]);

  const handleSave = async () => {
    if (savingRef.current || !editorReady) return;
    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    const saveRoute = routeRef.current;
    const request = saveRequestRef.current + 1;
    saveRequestRef.current = request;
    savingRef.current = true;
    setIsSaving(true);
    setError(null);
    try {
      if (id) {
        await dashboardApi.put(`/knowledge/articles/${id}`, {
          title,
          category_id: categoryId || null,
          content,
          tier
        });
      } else {
        await dashboardApi.post('/knowledge/articles', {
          title,
          category_id: categoryId || null,
          content,
          tier
        });
      }
      if (mountedRef.current && saveRequestRef.current === request && routeRef.current === saveRoute) navigate('/knowledge');
    } catch (err: any) {
      if (mountedRef.current && saveRequestRef.current === request && routeRef.current === saveRoute) setError(err.message);
    } finally {
      if (mountedRef.current && saveRequestRef.current === request && routeRef.current === saveRoute) {
        savingRef.current = false;
        setIsSaving(false);
      }
    }
  };

  const renderCategoryOptions = (cats: KnowledgeCategory[], parentId: string | null = null, depth = 0): React.ReactNode[] => {
    const children = cats.filter(c => c.parent_id === parentId);
    let options: React.ReactNode[] = [];

    for (const child of children) {
      const prefix = '\u00A0\u00A0'.repeat(depth * 2);
      options.push(
        <option key={child.id} value={child.id}>
          {prefix}{child.name}
        </option>
      );
      options = options.concat(renderCategoryOptions(cats, child.id, depth + 1));
    }
    return options;
  };

  return (
    <div className="tocyn-knowledge-editor">
      {/* Header */}
      <div className="tocyn-knowledge-editor-header">
        <div className="tocyn-knowledge-editor-heading">
          <ParkButton
            onClick={() => navigate('/knowledge')}
            aria-label="Back to knowledge base"
            disabled={isSaving || !editorReady}
            className="tocyn-knowledge-editor-back"
          >
            <ArrowLeft size={20} weight="duotone" aria-hidden="true" />
          </ParkButton>
          <h1 className="tocyn-knowledge-editor-title">
            {id ? 'Edit Article' : 'New Article'}
          </h1>
        </div>

        <ParkButton
          onClick={handleSave}
          disabled={isSaving || !editorReady}
          className="tocyn-knowledge-editor-save"
        >
          {isSaving ? (
            <SpinnerGap className="tocyn-knowledge-editor-spinner" size={18} weight="duotone" aria-hidden="true" />
          ) : (
            <FloppyDisk size={16} weight="duotone" aria-hidden="true" className="tocyn-knowledge-editor-save-icon" />
          )}
          {isSaving ? 'Processing...' : 'Save Article'}
        </ParkButton>
      </div>

      {/* Editor Content */}
      <div className="tocyn-knowledge-editor-content">
        <div className="tocyn-knowledge-editor-stack">
          {error && (
            <ParkEmptyState
              id={errorId}
              role="alert"
              title="Article editor unavailable."
              description={error}
              headingLevel={false}
              className="tocyn-knowledge-editor-error"
            />
          )}

          <div className="tocyn-knowledge-editor-card">
            <div className="tocyn-knowledge-editor-fields">
              <div className="tocyn-knowledge-editor-title-field tocyn-form-field">
                <label htmlFor={titleId}>Title *</label>
                <ParkInput
                  id={titleId}
                  type="text"
                  value={title}
                  disabled={isSaving || !editorReady}
                  onChange={e => setTitle(e.target.value)}
                  className="tocyn-form-control tocyn-knowledge-editor-control"
                  placeholder="e.g., How to reset your password"
                  required
                />
              </div>

              <div className="tocyn-form-field">
                <label htmlFor={categoryIdInput}>Category</label>
                <ParkSelect
                  id={categoryIdInput}
                  value={categoryId}
                  disabled={isSaving || !editorReady}
                  onChange={e => setCategoryId(e.target.value)}
                  className="tocyn-form-control tocyn-knowledge-editor-control"
                >
                  <option value="">No Category (Root)</option>
                  {renderCategoryOptions(categories)}
                </ParkSelect>
              </div>

              <div className="tocyn-form-field">
                <label htmlFor={tierId}>Tier</label>
                <ParkSelect
                  id={tierId}
                  value={tier}
                  disabled={isSaving || !editorReady}
                  onChange={e => setTier(e.target.value as 'answer' | 'sop')}
                  className="tocyn-form-control tocyn-knowledge-editor-control"
                >
                  <option value="answer">Customer Facing Answer</option>
                  <option value="sop">Internal SOP (Standard Operating Procedure)</option>
                </ParkSelect>
              </div>
            </div>

            <div className="tocyn-form-field">
              <label htmlFor={contentId}>Content (Markdown)</label>
              <div aria-busy={isSaving} aria-disabled={isSaving || !editorReady} onClickCapture={isSaving || !editorReady ? event => event.preventDefault() : undefined} onKeyDownCapture={isSaving || !editorReady ? event => event.preventDefault() : undefined}>
                <TiptapMarkdownField key={`${routeKey}-${editorReady ? 'ready' : 'loading'}`} id={contentId} value={content} readOnly={isSaving || !editorReady} ariaDescribedBy={error ? errorId : undefined} onChange={value => { if (!savingRef.current && editorReady) setContent(value); }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
