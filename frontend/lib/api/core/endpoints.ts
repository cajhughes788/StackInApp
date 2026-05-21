export const API_ENDPOINTS = {
  entries: {
    get: "https://getentries-3lc2fwdgwq-uc.a.run.app",
    post: "https://createentry-3lc2fwdgwq-uc.a.run.app",
    patch: "https://editentry-3lc2fwdgwq-uc.a.run.app",
    delete: "https://deleteentry-3lc2fwdgwq-uc.a.run.app",
  },

  expenses: {
    get: "https://getexpenses-3lc2fwdgwq-uc.a.run.app",
    post: "https://createexpense-3lc2fwdgwq-uc.a.run.app",
    patch: "https://editexpense-3lc2fwdgwq-uc.a.run.app",
    delete: "https://deleteexpense-3lc2fwdgwq-uc.a.run.app",
  },

  imports: {
    batch: {
      get: "https://getimportbatches-3lc2fwdgwq-uc.a.run.app",
      post: "https://createimportbatch-3lc2fwdgwq-uc.a.run.app",
    },
    items: {
      get: "https://getimportitems-3lc2fwdgwq-uc.a.run.app",
      patch: "https://updateimportitem-3lc2fwdgwq-uc.a.run.app",
    },
  },

  receiptAssets: {
    get: "https://getreceiptasset-3lc2fwdgwq-uc.a.run.app",
    post: "https://createreceiptasset-3lc2fwdgwq-uc.a.run.app",
    patch: "https://updatereceiptasset-3lc2fwdgwq-uc.a.run.app",
  },

  receiptAnalysis: {
    get: "https://getreceiptanalysis-3lc2fwdgwq-uc.a.run.app",
    post: "https://analyzereceipt-3lc2fwdgwq-uc.a.run.app",
    finalize: "https://finalizereceiptanalysis-3lc2fwdgwq-uc.a.run.app",
  },

  receiptDrafts: {
    get: "https://getreceiptdrafts-3lc2fwdgwq-uc.a.run.app",
    post: "https://createreceiptdraft-3lc2fwdgwq-uc.a.run.app",
    patch: "https://updatereceiptdraft-3lc2fwdgwq-uc.a.run.app",
  },

  taxProfile: {
    get: "https://gettaxprofile-3lc2fwdgwq-uc.a.run.app",
    post: "https://savetaxprofile-3lc2fwdgwq-uc.a.run.app",
  },

  settings: {
    get: (workspaceId: string) =>
      `https://getsettings-3lc2fwdgwq-uc.a.run.app?workspaceId=${workspaceId}`,
    post: (workspaceId: string) =>
      `https://savesettings-3lc2fwdgwq-uc.a.run.app?workspaceId=${workspaceId}`,
  },

  bootstrap: {
    get: (workspaceId: string) =>
      `https://getappbootstrap-3lc2fwdgwq-uc.a.run.app?workspaceId=${workspaceId}`,
  },

  support: {
    submit: "https://submitsupportreport-3lc2fwdgwq-uc.a.run.app",
  },

  paystubs: {
    get: "https://getpaystubs-3lc2fwdgwq-uc.a.run.app",
    generate: "https://generatepaystub-3lc2fwdgwq-uc.a.run.app",
    generateCurrent: "https://generatecurrentpaystub-3lc2fwdgwq-uc.a.run.app",
  },

  profitLoss: {
    get: "https://getprofitlossstatements-3lc2fwdgwq-uc.a.run.app",
    generate: "https://generateprofitlossstatement-3lc2fwdgwq-uc.a.run.app",
  },

  subscription: {
    get: "https://getsubscription-3lc2fwdgwq-uc.a.run.app",
  },

  user: {
    delete: "https://deleteuserdata-3lc2fwdgwq-uc.a.run.app",
    requestDeletion: "https://requestaccountdeletion-3lc2fwdgwq-uc.a.run.app",
    cancelDeletionRequest:
      "https://cancelaccountdeletionrequest-3lc2fwdgwq-uc.a.run.app",
    signup: "https://signup-3lc2fwdgwq-uc.a.run.app",
  },

  workspaces: {
    create: "https://createworkspace-3lc2fwdgwq-uc.a.run.app",
    update: (workspaceId: string) =>
      `https://updateworkspace-3lc2fwdgwq-uc.a.run.app?workspaceId=${workspaceId}`,
    delete: (workspaceId: string) =>
      `https://deleteworkspace-3lc2fwdgwq-uc.a.run.app?workspaceId=${workspaceId}`,
  },
} as const
