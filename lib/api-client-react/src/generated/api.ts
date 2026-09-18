export const getDeleteFixedAssetUrl = (id: number,) => {




  return `/api/fixed-assets/${id}`
}

/**
 * @summary Delete equipment or fixed asset and its linked cash transaction
 */
export const deleteFixedAsset = async (id: number, options?: Parameters<typeof customFetch>[1]): Promise<void> => {

  return customFetch<void>(getDeleteFixedAssetUrl(id),
  {
    ...options,
    method: 'DELETE'


  }
);}





export const getDeleteFixedAssetMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof deleteFixedAsset>>, TError,{id: number}, TContext>, request?: SecondParameter<typeof customFetch>}
): UseMutationOptions<Awaited<ReturnType<typeof deleteFixedAsset>>, TError,{id: number}, TContext> => {

const mutationKey = ['deleteFixedAsset'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};




      const mutationFn: MutationFunction<Awaited<ReturnType<typeof deleteFixedAsset>>, {id: number}> = (props) => {
          const {id} = props ?? {};

          return  deleteFixedAsset(id,requestOptions)
        }






  return  { mutationFn, ...mutationOptions }}

    export type DeleteFixedAssetMutationResult = NonNullable<Awaited<ReturnType<typeof deleteFixedAsset>>>

    export type DeleteFixedAssetMutationError = ErrorType<unknown>

    /**
 * @summary Delete equipment or fixed asset and its linked cash transaction
 */
export const useDeleteFixedAsset = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof deleteFixedAsset>>, TError,{id: number}, TContext>, request?: SecondParameter<typeof customFetch>}
 ): UseMutationResult<
        Awaited<ReturnType<typeof deleteFixedAsset>>,
        TError,
        {id: number},
        TContext
      > => {
      return useMutation(getDeleteFixedAssetMutationOptions(options));
    }

export const getListDeletionRequestsUrl = () => {




  return `/api/deletion-requests`
}

/**
 * @summary List deletion approval requests
 */
export const listDeletionRequests = async ( options?: Parameters<typeof customFetch>[1]): Promise<DeletionRequest[]> => {

  return customFetch<DeletionRequest[]>(getListDeletionRequestsUrl(),
  {
    ...options,
    method: 'GET'


  }
);}





export const getListDeletionRequestsQueryKey = () => {
    return [
    `/api/deletion-requests`
    ] as const;
    }


export const getListDeletionRequestsQueryOptions = <TData = Awaited<ReturnType<typeof listDeletionRequests>>, TError = ErrorType<unknown>>( options?: { query?:UseQueryOptions<Awaited<ReturnType<typeof listDeletionRequests>>, TError, TData>, request?: SecondParameter<typeof customFetch>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getListDeletionRequestsQueryKey();



    const queryFn: QueryFunction<Awaited<ReturnType<typeof listDeletionRequests>>> = ({ signal }) => listDeletionRequests({ signal, ...requestOptions });





   return  { queryKey, queryFn, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof listDeletionRequests>>, TError, TData> & { queryKey: QueryKey }
}

export type ListDeletionRequestsQueryResult = NonNullable<Awaited<ReturnType<typeof listDeletionRequests>>>
export type ListDeletionRequestsQueryError = ErrorType<unknown>


/**
 * @summary List deletion approval requests
 */

export function useListDeletionRequests<TData = Awaited<ReturnType<typeof listDeletionRequests>>, TError = ErrorType<unknown>>(
  options?: { query?:UseQueryOptions<Awaited<ReturnType<typeof listDeletionRequests>>, TError, TData>, request?: SecondParameter<typeof customFetch>}

 ):  UseQueryResult<TData, TError> & { queryKey: QueryKey } {

  const queryOptions = getListDeletionRequestsQueryOptions(options)

  const query = useQuery(queryOptions) as  UseQueryResult<TData, TError> & { queryKey: QueryKey };

  return withQueryKey(query, queryOptions.queryKey);
}







export const getCreateDeletionRequestUrl = () => {




  return `/api/deletion-requests`
}

/**
 * @summary Queue an operation for admin deletion approval
 */
export const createDeletionRequest = async (deletionRequestInput: DeletionRequestInput, options?: Parameters<typeof customFetch>[1]): Promise<DeletionRequest> => {

  return customFetch<DeletionRequest>(getCreateDeletionRequestUrl(),
  {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    body: JSON.stringify(deletionRequestInput)
  }
);}





export const getCreateDeletionRequestMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof createDeletionRequest>>, TError,{data: BodyType<DeletionRequestInput>}, TContext>, request?: SecondParameter<typeof customFetch>}
): UseMutationOptions<Awaited<ReturnType<typeof createDeletionRequest>>, TError,{data: BodyType<DeletionRequestInput>}, TContext> => {

const mutationKey = ['createDeletionRequest'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};




      const mutationFn: MutationFunction<Awaited<ReturnType<typeof createDeletionRequest>>, {data: BodyType<DeletionRequestInput>}> = (props) => {
          const {data} = props ?? {};

          return  createDeletionRequest(data,requestOptions)
        }






  return  { mutationFn, ...mutationOptions }}

    export type CreateDeletionRequestMutationResult = NonNullable<Awaited<ReturnType<typeof createDeletionRequest>>>
    export type CreateDeletionRequestMutationBody = BodyType<DeletionRequestInput>
    export type CreateDeletionRequestMutationError = ErrorType<unknown>

    /**
 * @summary Queue an operation for admin deletion approval
 */
export const useCreateDeletionRequest = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof createDeletionRequest>>, TError,{data: BodyType<DeletionRequestInput>}, TContext>, request?: SecondParameter<typeof customFetch>}
 ): UseMutationResult<
        Awaited<ReturnType<typeof createDeletionRequest>>,
        TError,
        {data: BodyType<DeletionRequestInput>},
        TContext
      > => {
      return useMutation(getCreateDeletionRequestMutationOptions(options));
    }

export const getApproveDeletionRequestUrl = (id: number,) => {




  return `/api/deletion-requests/${id}/approve`
}

/**
 * @summary Approve and execute a queued deletion
 */
export const approveDeletionRequest = async (id: number, options?: Parameters<typeof customFetch>[1]): Promise<DeletionRequest> => {

  return customFetch<DeletionRequest>(getApproveDeletionRequestUrl(id),
  {
    ...options,
    method: 'POST'


  }
);}





export const getApproveDeletionRequestMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof approveDeletionRequest>>, TError,{id: number}, TContext>, request?: SecondParameter<typeof customFetch>}
): UseMutationOptions<Awaited<ReturnType<typeof approveDeletionRequest>>, TError,{id: number}, TContext> => {

const mutationKey = ['approveDeletionRequest'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};




      const mutationFn: MutationFunction<Awaited<ReturnType<typeof approveDeletionRequest>>, {id: number}> = (props) => {
          const {id} = props ?? {};

          return  approveDeletionRequest(id,requestOptions)
        }






  return  { mutationFn, ...mutationOptions }}

    export type ApproveDeletionRequestMutationResult = NonNullable<Awaited<ReturnType<typeof approveDeletionRequest>>>

    export type ApproveDeletionRequestMutationError = ErrorType<unknown>

    /**
 * @summary Approve and execute a queued deletion
 */
export const useApproveDeletionRequest = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof approveDeletionRequest>>, TError,{id: number}, TContext>, request?: SecondParameter<typeof customFetch>}
 ): UseMutationResult<
        Awaited<ReturnType<typeof approveDeletionRequest>>,
        TError,
        {id: number},
        TContext
      > => {
      return useMutation(getApproveDeletionRequestMutationOptions(options));
    }

export const getCancelDeletionRequestUrl = (id: number,) => {




  return `/api/deletion-requests/${id}/cancel`
}

/**
 * @summary Cancel a queued deletion request
 */
export const cancelDeletionRequest = async (id: number, options?: Parameters<typeof customFetch>[1]): Promise<DeletionRequest> => {

  return customFetch<DeletionRequest>(getCancelDeletionRequestUrl(id),
  {
    ...options,
    method: 'POST'


  }
);}





export const getCancelDeletionRequestMutationOptions = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof cancelDeletionRequest>>, TError,{id: number}, TContext>, request?: SecondParameter<typeof customFetch>}
): UseMutationOptions<Awaited<ReturnType<typeof cancelDeletionRequest>>, TError,{id: number}, TContext> => {

const mutationKey = ['cancelDeletionRequest'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};




      const mutationFn: MutationFunction<Awaited<ReturnType<typeof cancelDeletionRequest>>, {id: number}> = (props) => {
          const {id} = props ?? {};

          return  cancelDeletionRequest(id,requestOptions)
        }






  return  { mutationFn, ...mutationOptions }}

    export type CancelDeletionRequestMutationResult = NonNullable<Awaited<ReturnType<typeof cancelDeletionRequest>>>

    export type CancelDeletionRequestMutationError = ErrorType<unknown>

    /**
 * @summary Cancel a queued deletion request
 */
export const useCancelDeletionRequest = <TError = ErrorType<unknown>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof cancelDeletionRequest>>, TError,{id: number}, TContext>, request?: SecondParameter<typeof customFetch>}
 ): UseMutationResult<
        Awaited<ReturnType<typeof cancelDeletionRequest>>,
        TError,
        {id: number},
        TContext
      > => {
      return useMutation(getCancelDeletionRequestMutationOptions(options));
    }

export const getListJournalEntriesUrl = (params?: ListJournalEntriesParams,) => {
  const normalizedParams = new URLSearchParams();

  Object.entries(params || {}).forEach(([key, value]) => {

    if (value !== undefined) {
      normalizedParams.append(key, value === null ? 'null' : String(value))
    }
  });

  const stringifiedParams = normalizedParams.toString();

  return stringifiedParams.length > 0 ? `/api/journal/entries?${stringifiedParams}` : `/api/journal/entries`
}

/**
 * @summary List journal entries
 */
export const listJournalEntries = async (params?: ListJournalEntriesParams, options?: Parameters<typeof customFetch>[1]): Promise<JournalEntrySummary[]> => {

  return customFetch<JournalEntrySummary[]>(getListJournalEntriesUrl(params),
  {
    ...options,
    method: 'GET'


  }
);}





export const getListJournalEntriesQueryKey = (params?: ListJournalEntriesParams,) => {
    return [
    `/api/journal/entries`, ...(params ? [params] : [])
    ] as const;
    }


export const getListJournalEntriesQueryOptions = <TData = Awaited<ReturnType<typeof listJournalEntries>>, TError = ErrorType<BadRequestResponse>>(params?: ListJournalEntriesParams, options?: { query?:UseQueryOptions<Awaited<ReturnType<typeof listJournalEntries>>, TError, TData>, request?: SecondParameter<typeof customFetch>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getListJournalEntriesQueryKey(params);



    const queryFn: QueryFunction<Awaited<ReturnType<typeof listJournalEntries>>> = ({ signal }) => listJournalEntries(params, { signal, ...requestOptions });





   return  { queryKey, queryFn, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof listJournalEntries>>, TError, TData> & { queryKey: QueryKey }
}

export type ListJournalEntriesQueryResult = NonNullable<Awaited<ReturnType<typeof listJournalEntries>>>
export type ListJournalEntriesQueryError = ErrorType<BadRequestResponse>


/**
 * @summary List journal entries
 */

export function useListJournalEntries<TData = Awaited<ReturnType<typeof listJournalEntries>>, TError = ErrorType<BadRequestResponse>>(
 params?: ListJournalEntriesParams, options?: { query?:UseQueryOptions<Awaited<ReturnType<typeof listJournalEntries>>, TError, TData>, request?: SecondParameter<typeof customFetch>}

 ):  UseQueryResult<TData, TError> & { queryKey: QueryKey } {

  const queryOptions = getListJournalEntriesQueryOptions(params,options)

  const query = useQuery(queryOptions) as  UseQueryResult<TData, TError> & { queryKey: QueryKey };

  return withQueryKey(query, queryOptions.queryKey);
}







export const getCreateJournalEntryUrl = () => {




  return `/api/journal/entries`
}

/**
 * @summary Create a manual journal entry
 */
export const createJournalEntry = async (journalEntryInput: JournalEntryInput, options?: Parameters<typeof customFetch>[1]): Promise<JournalEntry> => {

  return customFetch<JournalEntry>(getCreateJournalEntryUrl(),
  {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    body: JSON.stringify(journalEntryInput)
  }
);}





export const getCreateJournalEntryMutationOptions = <TError = ErrorType<BadRequestResponse | ConflictResponse>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof createJournalEntry>>, TError,{data: BodyType<JournalEntryInput>}, TContext>, request?: SecondParameter<typeof customFetch>}
): UseMutationOptions<Awaited<ReturnType<typeof createJournalEntry>>, TError,{data: BodyType<JournalEntryInput>}, TContext> => {

const mutationKey = ['createJournalEntry'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};




      const mutationFn: MutationFunction<Awaited<ReturnType<typeof createJournalEntry>>, {data: BodyType<JournalEntryInput>}> = (props) => {
          const {data} = props ?? {};

          return  createJournalEntry(data,requestOptions)
        }






  return  { mutationFn, ...mutationOptions }}

    export type CreateJournalEntryMutationResult = NonNullable<Awaited<ReturnType<typeof createJournalEntry>>>
    export type CreateJournalEntryMutationBody = BodyType<JournalEntryInput>
    export type CreateJournalEntryMutationError = ErrorType<BadRequestResponse | ConflictResponse>

    /**
 * @summary Create a manual journal entry
 */
export const useCreateJournalEntry = <TError = ErrorType<BadRequestResponse | ConflictResponse>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof createJournalEntry>>, TError,{data: BodyType<JournalEntryInput>}, TContext>, request?: SecondParameter<typeof customFetch>}
 ): UseMutationResult<
        Awaited<ReturnType<typeof createJournalEntry>>,
        TError,
        {data: BodyType<JournalEntryInput>},
        TContext
      > => {
      return useMutation(getCreateJournalEntryMutationOptions(options));
    }

export const getGetJournalEntryUrl = (id: number,) => {




  return `/api/journal/entries/${id}`
}

/**
 * @summary Get a journal entry with lines
 */
export const getJournalEntry = async (id: number, options?: Parameters<typeof customFetch>[1]): Promise<JournalEntry> => {

  return customFetch<JournalEntry>(getGetJournalEntryUrl(id),
  {
    ...options,
    method: 'GET'


  }
);}





export const getGetJournalEntryQueryKey = (id: number,) => {
    return [
    `/api/journal/entries/${id}`
    ] as const;
    }


export const getGetJournalEntryQueryOptions = <TData = Awaited<ReturnType<typeof getJournalEntry>>, TError = ErrorType<NotFoundResponse>>(id: number, options?: { query?:UseQueryOptions<Awaited<ReturnType<typeof getJournalEntry>>, TError, TData>, request?: SecondParameter<typeof customFetch>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getGetJournalEntryQueryKey(id);



    const queryFn: QueryFunction<Awaited<ReturnType<typeof getJournalEntry>>> = ({ signal }) => getJournalEntry(id, { signal, ...requestOptions });





   return  { queryKey, queryFn, enabled: id !== null && id !== undefined, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof getJournalEntry>>, TError, TData> & { queryKey: QueryKey }
}

export type GetJournalEntryQueryResult = NonNullable<Awaited<ReturnType<typeof getJournalEntry>>>
export type GetJournalEntryQueryError = ErrorType<NotFoundResponse>


/**
 * @summary Get a journal entry with lines
 */

export function useGetJournalEntry<TData = Awaited<ReturnType<typeof getJournalEntry>>, TError = ErrorType<NotFoundResponse>>(
 id: number, options?: { query?:UseQueryOptions<Awaited<ReturnType<typeof getJournalEntry>>, TError, TData>, request?: SecondParameter<typeof customFetch>}

 ):  UseQueryResult<TData, TError> & { queryKey: QueryKey } {

  const queryOptions = getGetJournalEntryQueryOptions(id,options)

  const query = useQuery(queryOptions) as  UseQueryResult<TData, TError> & { queryKey: QueryKey };

  return withQueryKey(query, queryOptions.queryKey);
}







export const getUpdateJournalEntryUrl = (id: number,) => {




  return `/api/journal/entries/${id}`
}

/**
 * @summary Update a draft journal entry
 */
export const updateJournalEntry = async (id: number,
    journalEntryUpdateInput: JournalEntryUpdateInput, options?: Parameters<typeof customFetch>[1]): Promise<JournalEntry> => {

  return customFetch<JournalEntry>(getUpdateJournalEntryUrl(id),
  {
    ...options,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    body: JSON.stringify(journalEntryUpdateInput)
  }
);}





export const getUpdateJournalEntryMutationOptions = <TError = ErrorType<BadRequestResponse | NotFoundResponse | ConflictResponse>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof updateJournalEntry>>, TError,{id: number;data: BodyType<JournalEntryUpdateInput>}, TContext>, request?: SecondParameter<typeof customFetch>}
): UseMutationOptions<Awaited<ReturnType<typeof updateJournalEntry>>, TError,{id: number;data: BodyType<JournalEntryUpdateInput>}, TContext> => {

const mutationKey = ['updateJournalEntry'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};




      const mutationFn: MutationFunction<Awaited<ReturnType<typeof updateJournalEntry>>, {id: number;data: BodyType<JournalEntryUpdateInput>}> = (props) => {
          const {id,data} = props ?? {};

          return  updateJournalEntry(id,data,requestOptions)
        }






  return  { mutationFn, ...mutationOptions }}

    export type UpdateJournalEntryMutationResult = NonNullable<Awaited<ReturnType<typeof updateJournalEntry>>>
    export type UpdateJournalEntryMutationBody = BodyType<JournalEntryUpdateInput>
    export type UpdateJournalEntryMutationError = ErrorType<BadRequestResponse | NotFoundResponse | ConflictResponse>

    /**
 * @summary Update a draft journal entry
 */
export const useUpdateJournalEntry = <TError = ErrorType<BadRequestResponse | NotFoundResponse | ConflictResponse>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof updateJournalEntry>>, TError,{id: number;data: BodyType<JournalEntryUpdateInput>}, TContext>, request?: SecondParameter<typeof customFetch>}
 ): UseMutationResult<
        Awaited<ReturnType<typeof updateJournalEntry>>,
        TError,
        {id: number;data: BodyType<JournalEntryUpdateInput>},
        TContext
      > => {
      return useMutation(getUpdateJournalEntryMutationOptions(options));
    }

export const getVoidJournalEntryUrl = (id: number,) => {




  return `/api/journal/entries/${id}/void`
}

/**
 * @summary Void a posted journal entry
 */
export const voidJournalEntry = async (id: number, options?: Parameters<typeof customFetch>[1]): Promise<JournalVoidResult> => {

  return customFetch<JournalVoidResult>(getVoidJournalEntryUrl(id),
  {
    ...options,
    method: 'POST'


  }
);}





export const getVoidJournalEntryMutationOptions = <TError = ErrorType<NotFoundResponse | ConflictResponse>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof voidJournalEntry>>, TError,{id: number}, TContext>, request?: SecondParameter<typeof customFetch>}
): UseMutationOptions<Awaited<ReturnType<typeof voidJournalEntry>>, TError,{id: number}, TContext> => {

const mutationKey = ['voidJournalEntry'];
const {mutation: mutationOptions, request: requestOptions} = options ?
      options.mutation && 'mutationKey' in options.mutation && options.mutation.mutationKey ?
      options
      : {...options, mutation: {...options.mutation, mutationKey}}
      : {mutation: { mutationKey, }, request: undefined};




      const mutationFn: MutationFunction<Awaited<ReturnType<typeof voidJournalEntry>>, {id: number}> = (props) => {
          const {id} = props ?? {};

          return  voidJournalEntry(id,requestOptions)
        }






  return  { mutationFn, ...mutationOptions }}

    export type VoidJournalEntryMutationResult = NonNullable<Awaited<ReturnType<typeof voidJournalEntry>>>

    export type VoidJournalEntryMutationError = ErrorType<NotFoundResponse | ConflictResponse>

    /**
 * @summary Void a posted journal entry
 */
export const useVoidJournalEntry = <TError = ErrorType<NotFoundResponse | ConflictResponse>,
    TContext = unknown>(options?: { mutation?:UseMutationOptions<Awaited<ReturnType<typeof voidJournalEntry>>, TError,{id: number}, TContext>, request?: SecondParameter<typeof customFetch>}
 ): UseMutationResult<
        Awaited<ReturnType<typeof voidJournalEntry>>,
        TError,
        {id: number},
        TContext
      > => {
      return useMutation(getVoidJournalEntryMutationOptions(options));
    }

export const getGetJournalAccountLedgerUrl = (id: number,) => {




  return `/api/journal/accounts/${id}/ledger`
}

/**
 * @summary Get the posted ledger for an account
 */
export const getJournalAccountLedger = async (id: number, options?: Parameters<typeof customFetch>[1]): Promise<JournalLedger> => {

  return customFetch<JournalLedger>(getGetJournalAccountLedgerUrl(id),
  {
    ...options,
    method: 'GET'


  }
);}





export const getGetJournalAccountLedgerQueryKey = (id: number,) => {
    return [
    `/api/journal/accounts/${id}/ledger`
    ] as const;
    }


export const getGetJournalAccountLedgerQueryOptions = <TData = Awaited<ReturnType<typeof getJournalAccountLedger>>, TError = ErrorType<NotFoundResponse>>(id: number, options?: { query?:UseQueryOptions<Awaited<ReturnType<typeof getJournalAccountLedger>>, TError, TData>, request?: SecondParameter<typeof customFetch>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getGetJournalAccountLedgerQueryKey(id);



    const queryFn: QueryFunction<Awaited<ReturnType<typeof getJournalAccountLedger>>> = ({ signal }) => getJournalAccountLedger(id, { signal, ...requestOptions });





   return  { queryKey, queryFn, enabled: id !== null && id !== undefined, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof getJournalAccountLedger>>, TError, TData> & { queryKey: QueryKey }
}

export type GetJournalAccountLedgerQueryResult = NonNullable<Awaited<ReturnType<typeof getJournalAccountLedger>>>
export type GetJournalAccountLedgerQueryError = ErrorType<NotFoundResponse>


/**
 * @summary Get the posted ledger for an account
 */

export function useGetJournalAccountLedger<TData = Awaited<ReturnType<typeof getJournalAccountLedger>>, TError = ErrorType<NotFoundResponse>>(
 id: number, options?: { query?:UseQueryOptions<Awaited<ReturnType<typeof getJournalAccountLedger>>, TError, TData>, request?: SecondParameter<typeof customFetch>}

 ):  UseQueryResult<TData, TError> & { queryKey: QueryKey } {

  const queryOptions = getGetJournalAccountLedgerQueryOptions(id,options)

  const query = useQuery(queryOptions) as  UseQueryResult<TData, TError> & { queryKey: QueryKey };

  return withQueryKey(query, queryOptions.queryKey);
}







export const getGetJournalTrialBalanceUrl = () => {




  return `/api/journal/trial-balance`
}

/**
 * @summary Get the posted trial balance
 */
export const getJournalTrialBalance = async ( options?: Parameters<typeof customFetch>[1]): Promise<JournalTrialBalance> => {

  return customFetch<JournalTrialBalance>(getGetJournalTrialBalanceUrl(),
  {
    ...options,
    method: 'GET'


  }
);}





export const getGetJournalTrialBalanceQueryKey = () => {
    return [
    `/api/journal/trial-balance`
    ] as const;
    }


export const getGetJournalTrialBalanceQueryOptions = <TData = Awaited<ReturnType<typeof getJournalTrialBalance>>, TError = ErrorType<unknown>>( options?: { query?:UseQueryOptions<Awaited<ReturnType<typeof getJournalTrialBalance>>, TError, TData>, request?: SecondParameter<typeof customFetch>}
) => {

const {query: queryOptions, request: requestOptions} = options ?? {};

  const queryKey =  queryOptions?.queryKey ?? getGetJournalTrialBalanceQueryKey();



    const queryFn: QueryFunction<Awaited<ReturnType<typeof getJournalTrialBalance>>> = ({ signal }) => getJournalTrialBalance({ signal, ...requestOptions });





   return  { queryKey, queryFn, ...queryOptions} as UseQueryOptions<Awaited<ReturnType<typeof getJournalTrialBalance>>, TError, TData> & { queryKey: QueryKey }
}

export type GetJournalTrialBalanceQueryResult = NonNullable<Awaited<ReturnType<typeof getJournalTrialBalance>>>
export type GetJournalTrialBalanceQueryError = ErrorType<unknown>


/**
 * @summary Get the posted trial balance
 */

export function useGetJournalTrialBalance<TData = Awaited<ReturnType<typeof getJournalTrialBalance>>, TError = ErrorType<unknown>>(
  options?: { query?:UseQueryOptions<Awaited<ReturnType<typeof getJournalTrialBalance>>, TError, TData>, request?: SecondParameter<typeof customFetch>}

 ):  UseQueryResult<TData, TError> & { queryKey: QueryKey } {

  const queryOptions = getGetJournalTrialBalanceQueryOptions(options)

  const query = useQuery(queryOptions) as  UseQueryResult<TData, TError> & { queryKey: QueryKey };

  return withQueryKey(query, queryOptions.queryKey);
}
