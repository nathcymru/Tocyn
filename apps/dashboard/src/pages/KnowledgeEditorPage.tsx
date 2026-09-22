import { ParkButton, ParkEmptyState, ParkInput, ParkKnowledgeEditor, ParkSkeleton } from '@luminatick/ui/park';
import { Field } from '@luminatick/ui/components';
import React, { useState, useEffect, useId, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { dashboardApi } from '../api/client';
import { KnowledgeCategory } from '../types';
import { TiptapMarkdownField } from '../components/RichComposer';
import { DashboardSelect } from '../components/DashboardSelect';
import { ArrowLeft, FloppyDisk, SpinnerGap } from '@phosphor-icons/react';

type EditorError = { source: 'article-load' | 'category-load' | 'validation' | 'save'; message: string };

const errorTitles: Record<EditorError['source'], string> = {
  'article-load': 'Article could not be loaded',
  'category-load': 'Categories could not be loaded',
  validation: 'Article needs a title',
  save: 'Article could not be saved',
};

export const KnowledgeEditorPage: React.FC = () => {
  const styles = ParkKnowledgeEditor();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const titleId = useId();
  const categoryIdInput = useId();
  const tierId = useId();
  const contentId = useId();
  const errorId = useId();
  const categoryErrorId = useId();
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
  const [articleError, setArticleError] = useState<EditorError | null>(null);
  const [categoryError, setCategoryError] = useState<EditorError | null>(null);
  const [formError, setFormError] = useState<EditorError | null>(null);
  const [articleLoadAttempt, setArticleLoadAttempt] = useState(0);
  const [categoryLoadAttempt, setCategoryLoadAttempt] = useState(0);
  const error = articleError ?? formError ?? categoryError;
  const secondaryCategoryError = formError !== null && articleError === null ? categoryError : null;

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
    setArticleError(null);
    setFormError(null);
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
        if (current) { setCategories(cats); setCategoryError(null); }
      } catch (err: any) {
        if (current) setCategoryError({ source: 'category-load', message: err.message });
      }
    };
    fetchCategories();
    return () => { current = false; };
  }, [categoryLoadAttempt]);

  useEffect(() => {
    let current = true;
    if (id) {
      setLoadedRouteKey(null);
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
          setArticleError(null);
        } catch (err: any) {
          if (current) setArticleError({ source: 'article-load', message: err.message });
        }
      };
      fetchArticle();
    }
    return () => { current = false; };
  }, [id, routeKey, articleLoadAttempt]);

  const handleSave = async () => {
    if (savingRef.current || !editorReady) return;
    if (!title.trim()) {
      setFormError({ source: 'validation', message: 'Title is required' });
      return;
    }

    const saveRoute = routeRef.current;
    const request = saveRequestRef.current + 1;
    saveRequestRef.current = request;
    savingRef.current = true;
    setIsSaving(true);
    setFormError(null);
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
      if (mountedRef.current && saveRequestRef.current === request && routeRef.current === saveRoute) setFormError({ source: 'save', message: err.message });
    } finally {
      if (mountedRef.current && saveRequestRef.current === request && routeRef.current === saveRoute) {
        savingRef.current = false;
        setIsSaving(false);
      }
    }
  };

  const renderCategoryOptions = (cats: KnowledgeCategory[], parentId: string | null = null, depth = 0): { value: string; label: string }[] => {
    const children = cats.filter(c => c.parent_id === parentId);
    let options: { value: string; label: string }[] = [];

    for (const child of children) {
      const prefix = '\u00A0\u00A0'.repeat(depth * 2);
      options.push({ value: child.id, label: `${prefix}${child.name}` });
      options = options.concat(renderCategoryOptions(cats, child.id, depth + 1));
    }
    return options;
  };

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.heading}>
          <ParkButton
            onClick={() => navigate('/knowledge')}
            aria-label="Back to knowledge base"
            disabled={isSaving || !editorReady}
            className={styles.back}
          >
            <ArrowLeft size={20} weight="duotone" aria-hidden="true" />
          </ParkButton>
          <h1 className={styles.title}>
            {id ? 'Edit Article' : 'New Article'}
          </h1>
        </div>

        <ParkButton
          onClick={handleSave}
          disabled={isSaving || !editorReady}
          className={styles.save}
        >
          {isSaving ? (
            <SpinnerGap className={styles.spinner} size={18} weight="duotone" aria-hidden="true" />
          ) : (
            <FloppyDisk size={16} weight="duotone" aria-hidden="true" />
          )}
          {isSaving ? 'Processing...' : 'Save Article'}
        </ParkButton>
      </div>

      {/* Editor Content */}
      <div className={styles.content}>
        <div className={styles.stack}>
          {error && (
            <ParkEmptyState
              id={errorId}
              role="alert"
              title={errorTitles[error.source]}
              description={error.message}
              action={error.source === 'article-load'
                ? <ParkButton onClick={() => { setArticleError(null); setArticleLoadAttempt(attempt => attempt + 1); }}>Retry article</ParkButton>
                : error.source === 'category-load'
                  ? <ParkButton onClick={() => { setCategoryError(null); setCategoryLoadAttempt(attempt => attempt + 1); }}>Retry categories</ParkButton>
                  : undefined}
              headingLevel={false}
              className={styles.error}
            />
          )}

          {secondaryCategoryError && <ParkEmptyState
            id={categoryErrorId}
            role="alert"
            title={errorTitles['category-load']}
            description={secondaryCategoryError.message}
            action={<ParkButton onClick={() => { setCategoryError(null); setCategoryLoadAttempt(attempt => attempt + 1); }}>Retry categories</ParkButton>}
            headingLevel={false}
            className={styles.error}
          />}

          {!editorReady && !articleError && <div role="status" aria-label="Loading article" className={styles.card}>
            <ParkSkeleton height="8" width="full" />
            <ParkSkeleton height="8" width="full" />
          </div>}

          <div className={styles.card}>
            <div className={styles.fields}>
              <Field.Root required className={styles.field}>
                <Field.Label htmlFor={titleId}>Title <Field.RequiredIndicator> *</Field.RequiredIndicator></Field.Label>
                <ParkInput
                  id={titleId}
                  type="text"
                  value={title}
                  disabled={isSaving || !editorReady}
                  onChange={e => setTitle(e.target.value)}
                  className={styles.control}
                  placeholder="e.g., How to reset your password"
                  required
                />
              </Field.Root>

              <div className={styles.field}>
                <DashboardSelect
                  id={categoryIdInput}
                  label="Category"
                  value={categoryId}
                  disabled={isSaving || !editorReady}
                  onValueChange={setCategoryId}
                  className={styles.control}
                  options={[{ value: '', label: 'No Category (Root)' }, ...renderCategoryOptions(categories)]}
                />
              </div>

              <div className={styles.field}>
                <DashboardSelect
                  id={tierId}
                  label="Tier"
                  value={tier}
                  disabled={isSaving || !editorReady}
                  onValueChange={value => setTier(value as 'answer' | 'sop')}
                  className={styles.control}
                  options={[{ value: 'answer', label: 'Customer Facing Answer' }, { value: 'sop', label: 'Internal SOP (Standard Operating Procedure)' }]}
                />
              </div>
            </div>

            <Field.Root className={styles.field}>
              <Field.Label id={`${contentId}-label`} htmlFor={contentId}>Content (Markdown)</Field.Label>
              <div className={styles.tiptap} aria-busy={isSaving} aria-disabled={isSaving || !editorReady} onClickCapture={isSaving || !editorReady ? event => event.preventDefault() : undefined} onKeyDownCapture={isSaving || !editorReady ? event => event.preventDefault() : undefined}>
                <TiptapMarkdownField key={`${routeKey}-${editorReady ? 'ready' : 'loading'}`} id={contentId} value={content} readOnly={isSaving || !editorReady} ariaLabelledBy={`${contentId}-label`} ariaDescribedBy={error ? errorId : undefined} onChange={value => { if (!savingRef.current && editorReady) setContent(value); }} />
              </div>
            </Field.Root>
          </div>
        </div>
      </div>
    </div>
  );
};
