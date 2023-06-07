import { global } from '@storybook/global';
import { toId, sanitize } from '@storybook/csf';
import type {
  StoryKind,
  ComponentTitle,
  StoryName,
  StoryId,
  Args,
  API_ComposedRef,
  API_HashEntry,
  API_LeafEntry,
  API_PreparedStoryIndex,
  SetStoriesPayload,
  API_StoryEntry,
  StoryIndex,
  API_LoadedRefData,
  API_IndexHash,
  StoryPreparedPayload,
  DocsPreparedPayload,
  API_DocsEntry,
} from '@storybook/types';
import {
  PRELOAD_ENTRIES,
  STORY_PREPARED,
  UPDATE_STORY_ARGS,
  RESET_STORY_ARGS,
  STORY_ARGS_UPDATED,
  STORY_CHANGED,
  SELECT_STORY,
  SET_STORIES,
  SET_INDEX,
  STORY_SPECIFIED,
  STORY_INDEX_INVALIDATED,
  CONFIG_ERROR,
  CURRENT_STORY_WAS_SET,
  STORY_MISSING,
  DOCS_PREPARED,
} from '@storybook/core-events';
import { logger } from '@storybook/client-logger';

// eslint-disable-next-line import/no-cycle
import { getEventMetadata } from '../lib/events';

import {
  denormalizeStoryParameters,
  transformStoryIndexToStoriesHash,
  getComponentLookupList,
  getStoriesLookupList,
  addPreparedStories,
} from '../lib/stories';

import type { ComposedRef, ModuleFn } from '../index';
import { merge } from '../index';

const { FEATURES, fetch } = global;
const STORY_INDEX_PATH = './index.json';

type Direction = -1 | 1;
type ParameterName = string;

type ViewMode = 'story' | 'info' | 'settings' | string | undefined;
type StoryUpdate = Partial<
  Pick<API_StoryEntry, 'prepared' | 'parameters' | 'initialArgs' | 'argTypes' | 'args'>
>;
interface StatusObject {
  status: 'pending' | 'success' | 'error' | 'warn' | 'unknown';
  title: string;
  description: string;
  data?: any;
}

type StatusState = Record<StoryId, Record<string, StatusObject>>;
type StatusUpdate = Record<StoryId, StatusObject>;

type DocsUpdate = Partial<Pick<API_DocsEntry, 'prepared' | 'parameters'>>;

export interface SubState extends API_LoadedRefData {
  storyId: StoryId;
  viewMode: ViewMode;
  status: StatusState;
}

export interface SubAPI {
  /**
   * The `storyId` method is a reference to the `toId` function from `@storybook/csf`, which is used to generate a unique ID for a story.
   * This ID is used to identify a specific story in the Storybook index.
   *
   * @type {typeof toId}
   */
  storyId: typeof toId;
  /**
   * Resolves a story ID to its corresponding hash entry in the story index.
   *
   * @param {StoryId} storyId - The ID of the story to resolve.
   * @param {string} [refsId] - The ID of the refs to use for resolving the story.
   * @returns {API_HashEntry} - The hash entry corresponding to the given story ID.
   */
  resolveStory: (storyId: StoryId, refsId?: string) => API_HashEntry;
  /**
   * Selects the first story to display in the Storybook UI.
   *
   * @returns {void}
   */
  selectFirstStory: () => void;
  /**
   * Selects a story to display in the Storybook UI.
   *
   * @param {string} [kindOrId] - The kind or ID of the story to select.
   * @param {StoryId} [story] - The ID of the story to select.
   * @param {Object} [obj] - An optional object containing additional options.
   * @param {string} [obj.ref] - The ref ID of the story to select.
   * @param {ViewMode} [obj.viewMode] - The view mode to display the story in.
   * @returns {void}
   */
  selectStory: (
    kindOrId?: string,
    story?: StoryId,
    obj?: { ref?: string; viewMode?: ViewMode }
  ) => void;
  /**
   * Returns the current story's data, including its ID, kind, name, and parameters.
   *
   * @returns {API_LeafEntry} The current story's data.
   */
  getCurrentStoryData: () => API_LeafEntry;
  /**
   * Sets the prepared story index to the given value.
   *
   * @param {API_PreparedStoryIndex} index - The prepared story index to set.
   * @returns {Promise<void>} A promise that resolves when the prepared story index has been set.
   */
  setIndex: (index: API_PreparedStoryIndex) => Promise<void>;

  /**
   * Jumps to the next or previous component in the component index.
   *
   * @param {Direction} direction - The direction to jump. Use -1 to jump to the previous component, and 1 to jump to the next component.
   * @returns {void}
   */
  jumpToComponent: (direction: Direction) => void;
  /**
   * Jumps to the next or previous story in the story index.
   *
   * @param {Direction} direction - The direction to jump. Use -1 to jump to the previous story, and 1 to jump to the next story.
   * @returns {void}
   */
  jumpToStory: (direction: Direction) => void;
  /**
   * Returns the data for the given story ID and optional ref ID.
   *
   * @param {StoryId} storyId - The ID of the story to retrieve data for.
   * @param {string} [refId] - The ID of the ref to retrieve data for. If not provided, retrieves data for the default ref.
   * @returns {API_LeafEntry} The data for the given story ID and optional ref ID.
   */
  getData: (storyId: StoryId, refId?: string) => API_LeafEntry;
  /**
   * Returns a boolean indicating whether the given story ID and optional ref ID have been prepared.
   *
   * @param {StoryId} storyId - The ID of the story to check.
   * @param {string} [refId] - The ID of the ref to check. If not provided, checks all refs for the given story ID.
   * @returns {boolean} A boolean indicating whether the given story ID and optional ref ID have been prepared.
   */
  isPrepared: (storyId: StoryId, refId?: string) => boolean;
  /**
   * Returns the parameters for the given story ID and optional ref ID.
   *
   * @param {StoryId | { storyId: StoryId; refId: string }} storyId - The ID of the story to retrieve parameters for, or an object containing the story ID and ref ID.
   * @param {ParameterName} [parameterName] - The name of the parameter to retrieve. If not provided, returns all parameters.
   * @returns {API_StoryEntry['parameters'] | any} The parameters for the given story ID and optional ref ID.
   */
  getParameters: (
    storyId: StoryId | { storyId: StoryId; refId: string },
    parameterName?: ParameterName
  ) => API_StoryEntry['parameters'] | any;
  /**
   * Returns the current value of the specified parameter for the currently selected story.
   *
   * @template S - The type of the parameter value.
   * @param {ParameterName} [parameterName] - The name of the parameter to retrieve. If not provided, returns all parameters.
   * @returns {S} The value of the specified parameter for the currently selected story.
   */
  getCurrentParameter<S>(parameterName?: ParameterName): S;
  /**
   * Updates the arguments for the given story with the provided new arguments.
   *
   * @param {API_StoryEntry} story - The story to update the arguments for.
   * @param {Args} newArgs - The new arguments to set for the story.
   * @returns {void}
   */
  updateStoryArgs(story: API_StoryEntry, newArgs: Args): void;
  /**
   * Resets the arguments for the given story to their initial values.
   *
   * @param {API_StoryEntry} story - The story to reset the arguments for.
   * @param {string[]} [argNames] - An optional array of argument names to reset. If not provided, all arguments will be reset.
   * @returns {void}
   */
  resetStoryArgs: (story: API_StoryEntry, argNames?: string[]) => void;
  /**
   * Finds the leaf entry for the given story ID in the given story index.
   *
   * @param {API_IndexHash} index - The story index to search for the leaf entry in.
   * @param {StoryId} storyId - The ID of the story to find the leaf entry for.
   * @returns {API_LeafEntry} The leaf entry for the given story ID, or null if no leaf entry was found.
   */
  findLeafEntry(index: API_IndexHash, storyId: StoryId): API_LeafEntry;
  /**
   * Finds the leaf story ID for the given story ID in the given story index.
   *
   * @param {API_IndexHash} index - The story index to search for the leaf story ID in.
   * @param {StoryId} storyId - The ID of the story to find the leaf story ID for.
   * @returns {StoryId} The ID of the leaf story, or null if no leaf story was found.
   */
  findLeafStoryId(index: API_IndexHash, storyId: StoryId): StoryId;
  /**
   * Finds the ID of the sibling story in the given direction for the given story ID in the given story index.
   *
   * @param {StoryId} storyId - The ID of the story to find the sibling of.
   * @param {API_IndexHash} index - The story index to search for the sibling in.
   * @param {Direction} direction - The direction to search for the sibling in.
   * @param {boolean} toSiblingGroup - When true, skips over leafs within the same group.
   * @returns {StoryId} The ID of the sibling story, or null if no sibling was found.
   */
  findSiblingStoryId(
    storyId: StoryId,
    index: API_IndexHash,
    direction: Direction,
    toSiblingGroup: boolean // when true, skip over leafs within the same group
  ): StoryId;
  /**
   * Fetches the story index from the server.
   *
   * @returns {Promise<void>} A promise that resolves when the index has been fetched.
   */
  fetchIndex: () => Promise<void>;
  /**
   * Updates the story with the given ID with the provided update object.
   *
   * @param {StoryId} storyId - The ID of the story to update.
   * @param {StoryUpdate} update - An object containing the updated story information.
   * @param {API_ComposedRef} [ref] - The composed ref of the story to update.
   * @returns {Promise<void>} A promise that resolves when the story has been updated.
   */
  updateStory: (storyId: StoryId, update: StoryUpdate, ref?: API_ComposedRef) => Promise<void>;
  /**
   * Updates the documentation for the given story ID with the given update object.
   *
   * @param {StoryId} storyId - The ID of the story to update.
   * @param {DocsUpdate} update - An object containing the updated documentation information.
   * @param {API_ComposedRef} [ref] - The composed ref of the story to update.
   * @returns {Promise<void>} A promise that resolves when the documentation has been updated.
   */
  updateDocs: (storyId: StoryId, update: DocsUpdate, ref?: API_ComposedRef) => Promise<void>;
  /**
   * Sets the preview as initialized.
   *
   * @param {ComposedRef} [ref] - The composed ref of the story to set as initialized.
   * @returns {Promise<void>} A promise that resolves when the preview has been set as initialized.
   */
  setPreviewInitialized: (ref?: ComposedRef) => Promise<void>;
  /**
   * Updates the status of a collection of stories.
   *
   * @param {string} addonId - The ID of the addon to update.
   * @param {StatusUpdate} update - An object containing the updated status information.
   * @returns {Promise<void>} A promise that resolves when the status has been updated.
   */
  experimental_updateStatus: (addonId: string, update: StatusUpdate) => Promise<void>;
}

const removedOptions = ['enableShortcuts', 'theme', 'showRoots'];

function removeRemovedOptions<T extends Record<string, any> = Record<string, any>>(options?: T): T {
  if (!options || typeof options === 'string') {
    return options;
  }
  const result: T = { ...options } as T;

  removedOptions.forEach((option) => {
    if (option in result) {
      delete result[option];
    }
  });

  return result;
}

export const init: ModuleFn<SubAPI, SubState, true> = ({
  fullAPI,
  store,
  navigate,
  provider,
  storyId: initialStoryId,
  viewMode: initialViewMode,
  docsOptions = {},
}) => {
  const api: SubAPI = {
    storyId: toId,
    getData: (storyId, refId) => {
      const result = api.resolveStory(storyId, refId);
      if (result?.type === 'story' || result?.type === 'docs') {
        return result;
      }
      return undefined;
    },
    isPrepared: (storyId, refId) => {
      const data = api.getData(storyId, refId);
      return data.type === 'story' ? data.prepared : true;
    },
    resolveStory: (storyId, refId) => {
      const { refs, index } = store.getState();
      if (refId && !refs[refId]) {
        return null;
      }
      if (refId) {
        return refs[refId].index ? refs[refId].index[storyId] : undefined;
      }
      return index ? index[storyId] : undefined;
    },
    getCurrentStoryData: () => {
      const { storyId, refId } = store.getState();

      return api.getData(storyId, refId);
    },
    getParameters: (storyIdOrCombo, parameterName) => {
      const { storyId, refId } =
        typeof storyIdOrCombo === 'string'
          ? { storyId: storyIdOrCombo, refId: undefined }
          : storyIdOrCombo;
      const data = api.getData(storyId, refId);

      if (['story', 'docs'].includes(data?.type)) {
        const { parameters } = data;

        if (parameters) {
          return parameterName ? parameters[parameterName] : parameters;
        }
      }

      return null;
    },
    getCurrentParameter: (parameterName) => {
      const { storyId, refId } = store.getState();
      const parameters = api.getParameters({ storyId, refId }, parameterName);
      // FIXME Returning falsey parameters breaks a bunch of toolbars code,
      // so this strange logic needs to be here until various client code is updated.
      return parameters || undefined;
    },
    jumpToComponent: (direction) => {
      const { index, storyId, refs, refId } = store.getState();
      const story = api.getData(storyId, refId);

      // cannot navigate when there's no current selection
      if (!story) {
        return;
      }

      const hash = refId ? refs[refId].index || {} : index;
      const result = api.findSiblingStoryId(storyId, hash, direction, true);

      if (result) {
        api.selectStory(result, undefined, { ref: refId });
      }
    },
    jumpToStory: (direction) => {
      const { index, storyId, refs, refId } = store.getState();
      const story = api.getData(storyId, refId);

      // cannot navigate when there's no current selection
      if (!story) {
        return;
      }

      const hash = story.refId ? refs[story.refId].index : index;
      const result = api.findSiblingStoryId(storyId, hash, direction, false);

      if (result) {
        api.selectStory(result, undefined, { ref: refId });
      }
    },
    selectFirstStory: () => {
      const { index } = store.getState();
      const firstStory = Object.keys(index).find((id) => index[id].type === 'story');

      if (firstStory) {
        api.selectStory(firstStory);
        return;
      }

      navigate('/');
    },
    selectStory: (titleOrId = undefined, name = undefined, options = {}) => {
      const { ref } = options;
      const { storyId, index, refs } = store.getState();

      const hash = ref ? refs[ref].index : index;

      const kindSlug = storyId?.split('--', 2)[0];

      if (!name) {
        // Find the entry (group, component or story) that is referred to
        const entry = titleOrId ? hash[titleOrId] || hash[sanitize(titleOrId)] : hash[kindSlug];

        if (!entry) throw new Error(`Unknown id or title: '${titleOrId}'`);

        // We want to navigate to the first ancestor entry that is a leaf
        const leafEntry = api.findLeafEntry(hash, entry.id);
        const fullId = leafEntry.refId ? `${leafEntry.refId}_${leafEntry.id}` : leafEntry.id;
        navigate(`/${leafEntry.type}/${fullId}`);
      } else if (!titleOrId) {
        // This is a slugified version of the kind, but that's OK, our toId function is idempotent
        const id = toId(kindSlug, name);

        api.selectStory(id, undefined, options);
      } else {
        const id = ref ? `${ref}_${toId(titleOrId, name)}` : toId(titleOrId, name);
        if (hash[id]) {
          api.selectStory(id, undefined, options);
        } else {
          // Support legacy API with component permalinks, where kind is `x/y` but permalink is 'z'
          const entry = hash[sanitize(titleOrId)];
          if (entry?.type === 'component') {
            const foundId = entry.children.find((childId) => hash[childId].name === name);
            if (foundId) {
              api.selectStory(foundId, undefined, options);
            }
          }
        }
      }
    },
    findLeafEntry(index, storyId) {
      const entry = index[storyId];
      if (entry.type === 'docs' || entry.type === 'story') {
        return entry;
      }

      const childStoryId = entry.children[0];
      return api.findLeafEntry(index, childStoryId);
    },
    findLeafStoryId(index, storyId) {
      return api.findLeafEntry(index, storyId)?.id;
    },
    findSiblingStoryId(storyId, index, direction, toSiblingGroup) {
      if (toSiblingGroup) {
        const lookupList = getComponentLookupList(index);
        const position = lookupList.findIndex((i) => i.includes(storyId));

        // cannot navigate beyond fist or last
        if (position === lookupList.length - 1 && direction > 0) {
          return;
        }
        if (position === 0 && direction < 0) {
          return;
        }

        if (lookupList[position + direction]) {
          // eslint-disable-next-line consistent-return
          return lookupList[position + direction][0];
        }
        return;
      }
      const lookupList = getStoriesLookupList(index);
      const position = lookupList.indexOf(storyId);

      // cannot navigate beyond fist or last
      if (position === lookupList.length - 1 && direction > 0) {
        return;
      }
      if (position === 0 && direction < 0) {
        return;
      }

      // eslint-disable-next-line consistent-return
      return lookupList[position + direction];
    },
    updateStoryArgs: (story, updatedArgs) => {
      const { id: storyId, refId } = story;
      fullAPI.emit(UPDATE_STORY_ARGS, {
        storyId,
        updatedArgs,
        options: { target: refId },
      });
    },
    resetStoryArgs: (story, argNames?: [string]) => {
      const { id: storyId, refId } = story;
      fullAPI.emit(RESET_STORY_ARGS, {
        storyId,
        argNames,
        options: { target: refId },
      });
    },
    fetchIndex: async () => {
      try {
        const result = await fetch(STORY_INDEX_PATH);
        if (result.status !== 200) throw new Error(await result.text());

        const storyIndex = (await result.json()) as StoryIndex;

        // We can only do this if the stories.json is a proper storyIndex
        if (storyIndex.v < 3) {
          logger.warn(`Skipping story index with version v${storyIndex.v}, awaiting SET_STORIES.`);
          return;
        }

        await fullAPI.setIndex(storyIndex);
      } catch (err) {
        await store.setState({ indexError: err });
      }
    },
    // The story index we receive on SET_INDEX is "prepared" in that it has parameters
    // The story index we receive on fetchStoryIndex is not, but all the prepared fields are optional
    // so we can cast one to the other easily enough
    setIndex: async (storyIndex: API_PreparedStoryIndex) => {
      const newHash = transformStoryIndexToStoriesHash(storyIndex, {
        provider,
        docsOptions,
      });

      // Now we need to patch in the existing prepared stories
      const oldHash = store.getState().index;

      await store.setState({ index: addPreparedStories(newHash, oldHash), indexError: undefined });
    },
    updateStory: async (
      storyId: StoryId,
      update: StoryUpdate,
      ref?: API_ComposedRef
    ): Promise<void> => {
      if (!ref) {
        const { index } = store.getState();
        index[storyId] = {
          ...index[storyId],
          ...update,
        } as API_StoryEntry;
        await store.setState({ index });
      } else {
        const { id: refId, index } = ref;
        index[storyId] = {
          ...index[storyId],
          ...update,
        } as API_StoryEntry;
        await fullAPI.updateRef(refId, { index });
      }
    },
    updateDocs: async (
      docsId: StoryId,
      update: DocsUpdate,
      ref?: API_ComposedRef
    ): Promise<void> => {
      if (!ref) {
        const { index } = store.getState();
        index[docsId] = {
          ...index[docsId],
          ...update,
        } as API_DocsEntry;
        await store.setState({ index });
      } else {
        const { id: refId, index } = ref;
        index[docsId] = {
          ...index[docsId],
          ...update,
        } as API_DocsEntry;
        await fullAPI.updateRef(refId, { index });
      }
    },
    setPreviewInitialized: async (ref?: ComposedRef): Promise<void> => {
      if (!ref) {
        store.setState({ previewInitialized: true });
      } else {
        fullAPI.updateRef(ref.id, { previewInitialized: true });
      }
    },

    /* EXPERIMENTAL APIs */
    experimental_updateStatus: async (id, update) => {
      const { status } = store.getState();
      const addition = Object.entries(update).reduce<StatusState>((acc, [storyId, value]) => {
        acc[storyId] = acc[storyId] || {};
        acc[storyId][id] = value;

        return acc;
      }, {});
      await store.setState({ status: merge(status, addition) }, { persistence: 'session' });
    },
  };

  const initModule = async () => {
    // On initial load, the local iframe will select the first story (or other "selection specifier")
    // and emit STORY_SPECIFIED with the id. We need to ensure we respond to this change.
    fullAPI.on(
      STORY_SPECIFIED,
      function handler({
        storyId,
        viewMode,
      }: {
        storyId: string;
        viewMode: ViewMode;
        [k: string]: any;
      }) {
        const { sourceType } = getEventMetadata(this, fullAPI);

        if (sourceType === 'local') {
          if (fullAPI.isSettingsScreenActive()) return;

          // Special case -- if we are already at the story being specified (i.e. the user started at a given story),
          // we don't need to change URL. See https://github.com/storybookjs/storybook/issues/11677
          const state = store.getState();
          if (state.storyId !== storyId || state.viewMode !== viewMode) {
            navigate(`/${viewMode}/${storyId}`);
          }
        }
      }
    );

    // The CURRENT_STORY_WAS_SET event is the best event to use to tell if a ref is ready.
    // Until the ref has a selection, it will not render anything (e.g. while waiting for
    // the preview.js file or the index to load). Once it has a selection, it will render its own
    // preparing spinner.
    fullAPI.on(CURRENT_STORY_WAS_SET, function handler() {
      const { ref } = getEventMetadata(this, fullAPI);
      fullAPI.setPreviewInitialized(ref);
    });

    fullAPI.on(STORY_CHANGED, function handler() {
      const { sourceType } = getEventMetadata(this, fullAPI);

      if (sourceType === 'local') {
        const options = fullAPI.getCurrentParameter('options');

        if (options) {
          fullAPI.setOptions(removeRemovedOptions(options));
        }
      }
    });

    fullAPI.on(STORY_PREPARED, function handler({ id, ...update }: StoryPreparedPayload) {
      const { ref, sourceType } = getEventMetadata(this, fullAPI);
      fullAPI.updateStory(id, { ...update, prepared: true }, ref);

      if (!ref) {
        if (!store.getState().hasCalledSetOptions) {
          const { options } = update.parameters;
          fullAPI.setOptions(removeRemovedOptions(options));
          store.setState({ hasCalledSetOptions: true });
        }
      }

      if (sourceType === 'local') {
        const { storyId, index, refId } = store.getState();

        // create a list of related stories to be preloaded
        const toBePreloaded = Array.from(
          new Set([
            api.findSiblingStoryId(storyId, index, 1, true),
            api.findSiblingStoryId(storyId, index, -1, true),
          ])
        ).filter(Boolean);

        fullAPI.emit(PRELOAD_ENTRIES, {
          ids: toBePreloaded,
          options: { target: refId },
        });
      }
    });

    fullAPI.on(DOCS_PREPARED, function handler({ id, ...update }: DocsPreparedPayload) {
      const { ref } = getEventMetadata(this, fullAPI);
      fullAPI.updateStory(id, { ...update, prepared: true }, ref);
    });

    fullAPI.on(SET_INDEX, function handler(index: API_PreparedStoryIndex) {
      const { ref } = getEventMetadata(this, fullAPI);

      if (!ref) {
        fullAPI.setIndex(index);
        const options = fullAPI.getCurrentParameter('options');
        fullAPI.setOptions(removeRemovedOptions(options));
      } else {
        fullAPI.setRef(ref.id, { ...ref, storyIndex: index }, true);
      }
    });

    // For composition back-compatibilty
    fullAPI.on(SET_STORIES, function handler(data: SetStoriesPayload) {
      const { ref } = getEventMetadata(this, fullAPI);
      const setStoriesData = data.v ? denormalizeStoryParameters(data) : data.stories;

      if (!ref) {
        throw new Error('Cannot call SET_STORIES for local frame');
      } else {
        fullAPI.setRef(ref.id, { ...ref, setStoriesData }, true);
      }
    });

    fullAPI.on(
      SELECT_STORY,
      function handler({
        kind,
        title = kind,
        story,
        name = story,
        storyId,
        ...rest
      }: {
        kind?: StoryKind;
        title?: ComponentTitle;
        story?: StoryName;
        name?: StoryName;
        storyId: string;
        viewMode: ViewMode;
      }) {
        const { ref } = getEventMetadata(this, fullAPI);

        if (!ref) {
          fullAPI.selectStory(storyId || title, name, rest);
        } else {
          fullAPI.selectStory(storyId || title, name, { ...rest, ref: ref.id });
        }
      }
    );

    fullAPI.on(
      STORY_ARGS_UPDATED,
      function handleStoryArgsUpdated({ storyId, args }: { storyId: StoryId; args: Args }) {
        const { ref } = getEventMetadata(this, fullAPI);
        fullAPI.updateStory(storyId, { args }, ref);
      }
    );

    // When there's a preview error, we don't show it in the manager, but simply
    fullAPI.on(CONFIG_ERROR, function handleConfigError(err) {
      const { ref } = getEventMetadata(this, fullAPI);
      fullAPI.setPreviewInitialized(ref);
    });

    fullAPI.on(STORY_MISSING, function handleConfigError(err) {
      const { ref } = getEventMetadata(this, fullAPI);
      fullAPI.setPreviewInitialized(ref);
    });

    if (FEATURES?.storyStoreV7) {
      provider.serverChannel?.on(STORY_INDEX_INVALIDATED, () => fullAPI.fetchIndex());
      await fullAPI.fetchIndex();
    }
  };

  return {
    api,
    state: {
      storyId: initialStoryId,
      viewMode: initialViewMode,
      hasCalledSetOptions: false,
      previewInitialized: false,
      status: {},
    },
    init: initModule,
  };
};
