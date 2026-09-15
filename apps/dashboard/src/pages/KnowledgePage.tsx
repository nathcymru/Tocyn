import { TocynDialog } from '@luminatick/ui/dialog';
import { ParkButton, ParkCard, ParkEmptyState, ParkInput, ParkPage } from '@luminatick/ui/park';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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

  const fetchData = async () => {
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
    } catch (err: any) {
      setError(err.message);
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
      <div key={node.id} className="tocyn-knowledge-category-node">
        <div
          className={`tocyn-knowledge-category-row ${
            isSelected ? 'tocyn-knowledge-category-row-selected' : 'tocyn-knowledge-category-row-inactive'
          }`}
          style={{ paddingLeft: `${depth * 1.5 + 0.5}rem` }}
        >
          <div className="tocyn-knowledge-category-main">
            {node.children.length > 0 ? (
              <ParkButton
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.name}`} aria-expanded={isExpanded} onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}
                className="tocyn-knowledge-category-toggle"
              >
                {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
              </ParkButton>
            ) : (
              <span className="tocyn-knowledge-category-spacer"></span>
            )}
            <ParkButton aria-pressed={isSelected} onClick={() => setSelectedCategoryId(node.id)} className="tocyn-knowledge-category-select">
            <IconFolder size={14} className={isSelected ? 'tocyn-knowledge-category-icon-selected' : 'tocyn-knowledge-category-icon'} />
            <span className="tocyn-knowledge-category-name">{node.name}</span>
            </ParkButton>
          </div>
          <div className="tocyn-knowledge-category-actions">
            <ParkButton
              onClick={(e) => {
                e.stopPropagation();
                setIsAddingCategory({ parentId: node.id });
                setExpandedCategories(prev => new Set(prev).add(node.id));
              }}
              className="tocyn-knowledge-category-add"
              title="Add Subcategory" aria-label={`Add subcategory to ${node.name}`}
            >
              <IconPlus size={14} />
            </ParkButton>
            <ParkButton
              onClick={(e) => {
                e.stopPropagation();
                confirmDeleteCategory(node.id, node.name, e.currentTarget);
              }}
              className="tocyn-knowledge-category-delete"
              title="Delete Category" aria-label={`Delete category ${node.name}`}
            >
              <IconTrash size={14} />
            </ParkButton>
          </div>
        </div>

        {isExpanded && node.children.length > 0 && (
          <div className="tocyn-knowledge-category-children">
            {node.children.map(child => renderCategoryNode(child, depth + 1))}
          </div>
        )}

        {isAddingCategory?.parentId === node.id && (
          <div
            className="tocyn-knowledge-category-add-row"
            style={{ paddingLeft: `${(depth + 1) * 1.5 + 0.5}rem` }}
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
              className="tocyn-form-control"
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
    <div className={[ParkPage('knowledge').root, ParkPage('knowledge').content, 'tocyn-knowledge-page'].join(' ')}>
      <div className="tocyn-knowledge-header">
        <h1 ref={heading} tabIndex={-1} className="tocyn-knowledge-title">Knowledge Base</h1>
        <ParkButton
          onClick={() => navigate('/knowledge/new' + (selectedCategoryId ? `?categoryId=${selectedCategoryId}` : ''))}
          variant="solid" className="tocyn-knowledge-new-button"
        >
          <IconPlus size={16} className="tocyn-knowledge-new-icon" />
          New Article
        </ParkButton>
      </div>

      {error && (
        <div className="tocyn-knowledge-error" role="alert">
          {error}
        </div>
      )}

      <div className="tocyn-knowledge-workspace">
        {/* Sidebar */}
        <ParkCard.Root variant="outline" className="tocyn-knowledge-sidebar">
          <ParkCard.Header className="tocyn-knowledge-sidebar-header">
            <h2 className="tocyn-knowledge-sidebar-title">Categories</h2>
            <ParkButton
              onClick={() => setIsAddingCategory({ parentId: null })}
              className="tocyn-knowledge-add-category"
              title="Add Root Category"
            >
              <IconPlus size={16} />
            </ParkButton>
          </ParkCard.Header>

          <ParkCard.Body className="tocyn-knowledge-sidebar-body">
            <ParkButton aria-pressed={selectedCategoryId === null}
              className={`tocyn-knowledge-all-articles ${
                selectedCategoryId === null ? 'tocyn-knowledge-all-articles--active' : ''
              }`}
              onClick={() => setSelectedCategoryId(null)}
            >
              <IconFileLines size={16} className="tocyn-knowledge-all-icon" />
              <span>All Articles</span>
            </ParkButton>

            <div className="tocyn-knowledge-category-list">
              {categories.map(root => renderCategoryNode(root))}

              {isAddingCategory?.parentId === null && (
                <div className="tocyn-knowledge-category-add-row-root">
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
                    className="tocyn-knowledge-category-add-input"
                    placeholder="New category..."
                  />
                </div>
              )}
            </div>
          </ParkCard.Body>
        </ParkCard.Root>

        {/* Main Content */}
        <ParkCard.Root variant="outline" className="tocyn-knowledge-content">
          <ParkCard.Body className="tocyn-knowledge-table-shell">
            <table className="tocyn-knowledge-table">
              <thead className="tocyn-knowledge-table-head">
                <tr>
                  <th>Title</th><th>Status</th><th>Tier</th><th>Created</th><th className="tocyn-knowledge-table-actions-heading">Actions</th>
                </tr>
              </thead>
              <tbody className="tocyn-knowledge-table-body">
                {filteredDocs.map((doc) => (
                  <tr
                    key={doc.id}
                    className="tocyn-knowledge-table-row"
                    onClick={() => navigate(`/knowledge/edit/${doc.id}`)}
                  >
                    <td className="tocyn-knowledge-cell-title">{doc.title}</td>
                    <td className="tocyn-knowledge-cell-muted">
                      <span className={`tocyn-knowledge-status-badge ${
                        doc.status === 'active' ? 'tocyn-knowledge-status-active' :
                        doc.status === 'processing' ? 'tocyn-knowledge-status-processing' : 'tocyn-knowledge-status-error'
                      }`}>
                        {doc.status}
                      </span>
                    </td>
                    <td className="tocyn-knowledge-cell-muted">
                      <span className={`tocyn-knowledge-status-badge ${
                        doc.tier === 'sop' ? 'tocyn-knowledge-tier-sop' : 'tocyn-knowledge-tier-answer'
                      }`}>
                        {doc.tier === 'sop' ? 'SOP' : 'Answer'}
                      </span>
                    </td>
                    <td className="tocyn-knowledge-cell-muted">
                      {new Date(doc.created_at).toLocaleDateString()}
                    </td>
                    <td className="tocyn-knowledge-cell-actions">
                      <ParkButton
                        onClick={(e) => confirmDeleteDoc(doc.id, doc.title, e)}
                        className="tocyn-knowledge-delete"
                      >
                        Delete
                      </ParkButton>
                    </td>
                  </tr>
                ))}
                {filteredDocs.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <ParkEmptyState title="No articles found" description="No knowledge articles are available in this category." headingLevel={false} className="tocyn-knowledge-empty-state" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </ParkCard.Body>
        </ParkCard.Root>
      </div>

      {deleteStatus && <p role="status">{deleteStatus}</p>}
      <TocynDialog open={deleteConfirm.isOpen} busy={deleting} labelledBy={deleteTitleId} initialFocusEl={() => deleteCancel.current}
        finalFocusEl={() => deleteSucceeded.current ? heading.current : deleteOpener.current} onOpenChange={next => { if (!next) closeDelete(); }}>
          <div className="tocyn-knowledge-delete-dialog">
            <h3 id={deleteTitleId} className="tocyn-knowledge-delete-title">Confirm Deletion</h3>
            <p className="tocyn-knowledge-delete-copy">{deleteConfirm.title}</p>
            {deleteError && <p role="alert" className="tocyn-knowledge-delete-error">{deleteError}</p>}
            <div className="tocyn-knowledge-delete-actions">
              <ParkButton
                ref={deleteCancel} disabled={deleting} onClick={closeDelete}
                className="tocyn-knowledge-delete-cancel"
              >
                Cancel
              </ParkButton>
              <ParkButton
                disabled={deleting} onClick={executeDelete}
                className="tocyn-knowledge-delete-confirm"
              >
                Delete
              </ParkButton>
            </div>
          </div>
      </TocynDialog>
    </div>
  );
};
