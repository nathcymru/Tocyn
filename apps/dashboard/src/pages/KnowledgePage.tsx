import { ParkAlert, ParkButton, ParkCard, ParkDialog, ParkEmptyState, ParkInput, ParkPage, ParkSkeleton, ParkTable } from '@luminatick/ui/park';
import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Link as ParkLink } from '@luminatick/ui/components';
import { css } from '@luminatick/ui/styled-system/css';
import { dashboardApi } from '../api/client';
import { KnowledgeCategory, KnowledgeDoc } from '../types';
import {
  IconPlus,
  IconFolder,
  IconFileLines,
  IconTrash,
  IconChevronRight,
  IconChevronDown
} from '@luminatick/ui/icons';

interface CategoryNode extends KnowledgeCategory {
  children: CategoryNode[];
}

export const KnowledgePage: React.FC = () => {
  const [categories, setCategories] = useState<CategoryNode[]>([]);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [hasLoadedData, setHasLoadedData] = useState(false);
  const [isAddingCategory, setIsAddingCategory] = useState<{ parentId: string | null } | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    type: 'category' | 'document' | null;
    id: string | null;
    title: string;
  }>({ isOpen: false, type: null, id: null, title: '' });

  const deleteTitleId = React.useId();
  const deleteDescriptionId = React.useId();
  const deleteOpener = React.useRef<HTMLButtonElement | null>(null);
  const deleteCancel = React.useRef<HTMLButtonElement>(null);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const deleteGuard = React.useRef(false);
  const deleteSucceeded = React.useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteStatus, setDeleteStatus] = useState('');
  const closeDelete = () => { if (!deleteGuard.current) setDeleteConfirm(previous => ({...previous,isOpen:false})); };
  const navigate = useNavigate();
  const pageStyles = ParkPage('knowledge');

  const fetchData = async () => {
    setLoadState('loading');
    setError(null);
    try {
      const [cats, articles] = await Promise.all([
        dashboardApi.get<KnowledgeCategory[]>('/knowledge/categories'),
        dashboardApi.get<KnowledgeDoc[]>('/knowledge/articles')
      ]);

      const categoryMap = new Map<string, CategoryNode>();
      const roots: CategoryNode[] = [];

      cats.forEach(c => {
        categoryMap.set(c.id, { ...c, children: [] });
      });

      cats.forEach(c => {
        const node = categoryMap.get(c.id)!;
        if (c.parent_id && categoryMap.has(c.parent_id)) {
          categoryMap.get(c.parent_id)!.children.push(node);
        } else {
          roots.push(node);
        }
      });

      setCategories(roots);
      setDocs(articles);
      setHasLoadedData(true);
      setLoadState('ready');
    } catch (err: any) {
      setError(err.message);
      setLoadState('error');
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAddCategory = async (parentId: string | null) => {
    if (!newCategoryName.trim()) {
      setIsAddingCategory(null);
      return;
    }
    try {
      await dashboardApi.post('/knowledge/categories', {
        name: newCategoryName,
        parent_id: parentId
      });
      setNewCategoryName('');
      setIsAddingCategory(null);
      if (parentId) {
        setExpandedCategories(prev => new Set(prev).add(parentId));
      }
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const confirmDeleteCategory = (id: string, name: string, opener: HTMLButtonElement) => {
    deleteOpener.current = opener; deleteSucceeded.current = false; setDeleteError('');
    setDeleteConfirm({
      isOpen: true,
      type: 'category',
      id,
      title: `Are you sure you want to delete the category "${name}"?`
    });
  };

  const confirmDeleteDoc = (id: string, title: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    deleteOpener.current = e.currentTarget; deleteSucceeded.current = false; setDeleteError('');
    setDeleteConfirm({
      isOpen: true,
      type: 'document',
      id,
      title: `Are you sure you want to delete the document "${title}"?`
    });
  };

  const executeDelete = async () => {
    if (!deleteConfirm.id || !deleteConfirm.type || deleteGuard.current) return;
    deleteGuard.current = true; setDeleting(true); setDeleteError(''); setDeleteStatus('');
    try {
      if (deleteConfirm.type === 'category') {
        await dashboardApi.delete(`/knowledge/categories/${deleteConfirm.id}`);
        if (selectedCategoryId === deleteConfirm.id) {
          setSelectedCategoryId(null);
        }
      } else {
        await dashboardApi.delete(`/knowledge/articles/${deleteConfirm.id}`);
      }
      deleteSucceeded.current = true;
      setDeleteConfirm(previous => ({...previous,isOpen:false}));
      setDeleteStatus('Deletion completed.');
      fetchData();
    } catch {
      setDeleteError('Deletion failed. The item has been kept selected; try again.');
    } finally { deleteGuard.current = false; setDeleting(false); }
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expandedCategories);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setExpandedCategories(next);
  };

  const renderCategoryNode = (node: CategoryNode, depth = 0) => {
    const isExpanded = expandedCategories.has(node.id);
    const isSelected = selectedCategoryId === node.id;

    return (
      <div key={node.id}>
        <div
          className={[pageStyles.knowledgeCategoryRow, css({ display: 'grid', w: 'full', maxW: 'full', gridTemplateColumns: { base: 'minmax(0, 1fr)', sm: 'minmax(0, 1fr) auto' } }), isSelected ? pageStyles.knowledgeCategoryRowSelected : ''].filter(Boolean).join(' ')}
          style={{ ['--tocyn-category-depth' as string]: depth }}
        >
          <div className={pageStyles.knowledgeCategoryMain}>
            {node.children.length > 0 ? (
              <ParkButton
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.name}`} aria-expanded={isExpanded} onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}
               
              >
                {isExpanded ? <IconChevronDown size={14} aria-hidden="true" /> : <IconChevronRight size={14} aria-hidden="true" />}
              </ParkButton>
            ) : (
              <span className={pageStyles.knowledgeCategorySpacer}></span>
            )}
            <ParkButton aria-pressed={isSelected} onClick={() => setSelectedCategoryId(node.id)} className={`${pageStyles.knowledgeCategoryButton} ${css({ w: 'full', maxW: 'full', h: 'auto', minH: '10', whiteSpace: 'normal', overflowWrap: 'anywhere' })}`}>
            <IconFolder size={14} aria-hidden="true" className={css({ flexShrink: 0 })} />
            <span className={css({ minW: 0, whiteSpace: 'normal', overflowWrap: 'anywhere' })}>{node.name}</span>
            </ParkButton>
          </div>
          <div className={`${pageStyles.knowledgeCategoryActions} ${css({ justifySelf: 'end' })}`}>
            <ParkButton
              onClick={(e) => {
                e.stopPropagation();
                setIsAddingCategory({ parentId: node.id });
                setExpandedCategories(prev => new Set(prev).add(node.id));
              }}
             
              title="Add Subcategory" aria-label={`Add subcategory to ${node.name}`}
            >
              <IconPlus size={14} aria-hidden="true" />
            </ParkButton>
            <ParkButton
              onClick={(e) => {
                e.stopPropagation();
                confirmDeleteCategory(node.id, node.name, e.currentTarget);
              }}
             
              title="Delete Category" aria-label={`Delete category ${node.name}`}
            >
              <IconTrash size={14} aria-hidden="true" />
            </ParkButton>
          </div>
        </div>

        {isExpanded && node.children.length > 0 && (
          <div className={pageStyles.knowledgeCategoryChildren}>
            {node.children.map(child => renderCategoryNode(child, depth + 1))}
          </div>
        )}

        {isAddingCategory?.parentId === node.id && (
          <div
            className={pageStyles.knowledgeCategoryRow}
            style={{ ['--tocyn-category-depth' as string]: depth + 1 }}
          >
            <ParkInput
              aria-label={`New subcategory name for ${node.name}`}
              autoFocus
              type="text"
              value={newCategoryName}
              onChange={e => setNewCategoryName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddCategory(node.id);
                if (e.key === 'Escape') setIsAddingCategory(null);
              }}
              onBlur={() => handleAddCategory(node.id)}
              placeholder="New category..."
            />
          </div>
        )}
      </div>
    );
  };

  const filteredDocs = docs.filter(doc =>
    selectedCategoryId === null || doc.category_id === selectedCategoryId
  );
  return (
    <div className={[pageStyles.root, pageStyles.content].join(' ')}>
      <header className={pageStyles.header}>
        <h1 ref={heading} tabIndex={-1}>Knowledge Base</h1>
        <ParkButton
          onClick={() => navigate('/knowledge/new' + (selectedCategoryId ? `?categoryId=${selectedCategoryId}` : ''))}
          variant="solid"
        >
          <IconPlus size={16} aria-hidden="true" />
          New Article
        </ParkButton>
      </header>

      {error && (hasLoadedData ? <ParkAlert.Root role="alert" status="warning" variant="surface">
        <ParkAlert.Content>
          <ParkAlert.Title>{loadState === 'error' ? 'Knowledge could not be refreshed' : 'Knowledge change failed'}</ParkAlert.Title>
          <ParkAlert.Description>{loadState === 'error' ? 'Showing the last loaded categories and articles. ' : ''}{error}</ParkAlert.Description>
          {loadState === 'error' && <ParkButton type="button" onClick={() => void fetchData()}>Retry knowledge</ParkButton>}
        </ParkAlert.Content>
      </ParkAlert.Root> : <ParkEmptyState role="alert" title="Knowledge could not be loaded" description={error} headingLevel={false}
        action={<ParkButton type="button" onClick={() => void fetchData()}>Retry knowledge</ParkButton>} />)}
      {hasLoadedData && loadState === 'loading' && <p role="status" className={css({ color: 'fg.muted', fontSize: 'sm' })}>Refreshing knowledge…</p>}

      {(hasLoadedData || loadState !== 'error') && <div className={pageStyles.knowledgeWorkspace}>
        {/* Sidebar */}
        <ParkCard.Root variant="outline" className={pageStyles.knowledgeSidebar}>
          <ParkCard.Header>
            <h2>Categories</h2>
            <ParkButton
              onClick={() => setIsAddingCategory({ parentId: null })}
              variant="plain"
              title="Add Root Category" aria-label="Add Root Category"
            >
              <IconPlus size={16} aria-hidden="true" />
            </ParkButton>
          </ParkCard.Header>

          <ParkCard.Body>
            <ParkButton aria-pressed={selectedCategoryId === null}
              className={pageStyles.knowledgeCategoryButton}
              onClick={() => setSelectedCategoryId(null)}
            >
              <IconFileLines size={16} aria-hidden="true" />
              <span>All Articles</span>
            </ParkButton>

      <div className={pageStyles.knowledgeCategoryList}>
              {categories.map(root => renderCategoryNode(root))}

              {isAddingCategory?.parentId === null && (
                <div>
                  <ParkInput
                    aria-label="New root category name"
                    autoFocus
                    type="text"
                    value={newCategoryName}
                    onChange={e => setNewCategoryName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleAddCategory(null);
                      if (e.key === 'Escape') setIsAddingCategory(null);
                    }}
                    onBlur={() => handleAddCategory(null)}
                   
                    placeholder="New category..."
                  />
                </div>
              )}
            </div>
          </ParkCard.Body>
        </ParkCard.Root>

        {/* Main Content */}
        <ParkCard.Root variant="outline" className={pageStyles.knowledgeContent}>
          <ParkCard.Body>
            {hasLoadedData && filteredDocs.length === 0 ? (
              <ParkEmptyState title="No articles found" description="No knowledge articles are available in this category." headingLevel={false}
                action={<ParkButton onClick={() => navigate('/knowledge/new' + (selectedCategoryId ? `?categoryId=${selectedCategoryId}` : ''))}>Create article</ParkButton>} />
            ) : (
            <div role="region" aria-label="Knowledge articles" tabIndex={0} className={css({ maxW: 'full', overflowX: 'auto', _focusVisible: { outline: '2px solid', outlineColor: 'border.focus', outlineOffset: '2px' } })}>
            <ParkTable.Root className={`${pageStyles.knowledgeTable} ${css({ minW: '44rem' })}`}>
              <ParkTable.Head>
                <ParkTable.Row>
                  <ParkTable.Header scope="col" className={css({ w: '32%' })}>Title</ParkTable.Header><ParkTable.Header scope="col">Status</ParkTable.Header><ParkTable.Header scope="col">Tier</ParkTable.Header><ParkTable.Header scope="col">Created</ParkTable.Header><ParkTable.Header scope="col">Actions</ParkTable.Header>
                </ParkTable.Row>
              </ParkTable.Head>
              <ParkTable.Body>
                {loadState === 'loading' && !hasLoadedData && <ParkTable.Row><ParkTable.Cell colSpan={5}>
                  <div role="status" aria-label="Loading knowledge articles">
                    <ParkSkeleton height="8" width="full" />
                    <ParkSkeleton height="8" width="full" />
                    <ParkSkeleton height="8" width="full" />
                  </div>
                </ParkTable.Cell></ParkTable.Row>}
                {hasLoadedData && filteredDocs.map((doc) => (
                  <ParkTable.Row
                    key={doc.id}
                    className={pageStyles.knowledgeRow}
                  >
                    <ParkTable.Cell><ParkLink asChild variant="plain"><Link to={`/knowledge/edit/${doc.id}`} aria-label={`Edit ${doc.title}`} className={css({ minW: 0, minH: '10', maxW: 'full', whiteSpace: 'normal', overflowWrap: 'anywhere', textAlign: 'start' })}>{doc.title}</Link></ParkLink></ParkTable.Cell>
                    <ParkTable.Cell>
                      <span className={pageStyles.knowledgeStatusBadge} data-status={doc.status}>
                        {doc.status}
                      </span>
                    </ParkTable.Cell>
                    <ParkTable.Cell>
                      <span className={pageStyles.knowledgeStatusBadge} data-tier={doc.tier}>
                        {doc.tier === 'sop' ? 'SOP' : 'Answer'}
                      </span>
                    </ParkTable.Cell>
                    <ParkTable.Cell>
                      {new Date(doc.created_at).toLocaleDateString()}
                    </ParkTable.Cell>
                    <ParkTable.Cell>
                      <ParkButton
                        onClick={(e) => confirmDeleteDoc(doc.id, doc.title, e)}
                       
                      >
                        Delete
                      </ParkButton>
                    </ParkTable.Cell>
                  </ParkTable.Row>
                ))}
              </ParkTable.Body>
            </ParkTable.Root>
            </div>
            )}
          </ParkCard.Body>
        </ParkCard.Root>
      </div>}

      {deleteStatus && <p role="status">{deleteStatus}</p>}
      <ParkDialog.Root open={deleteConfirm.isOpen} onOpenChange={({ open }) => { if (!open && !deleting) closeDelete(); }}
        initialFocusEl={() => deleteCancel.current}
        finalFocusEl={() => deleteSucceeded.current ? heading.current : deleteOpener.current}
        closeOnEscape={!deleting} closeOnInteractOutside={false} lazyMount unmountOnExit>
        <ParkDialog.Backdrop />
        <ParkDialog.Positioner>
          <ParkDialog.Content aria-labelledby={deleteTitleId} aria-describedby={deleteDescriptionId}>
            <ParkDialog.Header><ParkDialog.Title id={deleteTitleId}>Confirm Deletion</ParkDialog.Title></ParkDialog.Header>
            <ParkDialog.Body>
              <ParkDialog.Description id={deleteDescriptionId}>{deleteConfirm.title}</ParkDialog.Description>
              {deleteError && <ParkAlert.Root role="alert" status="error" variant="surface">
                <ParkAlert.Content><ParkAlert.Description>{deleteError}</ParkAlert.Description></ParkAlert.Content>
              </ParkAlert.Root>}
            </ParkDialog.Body>
            <ParkDialog.Footer>
              <ParkButton type="button" ref={deleteCancel} disabled={deleting} onClick={closeDelete}>Cancel</ParkButton>
              <ParkButton type="button" disabled={deleting} onClick={executeDelete}>Delete</ParkButton>
            </ParkDialog.Footer>
          </ParkDialog.Content>
        </ParkDialog.Positioner>
      </ParkDialog.Root>
    </div>
  );
};
