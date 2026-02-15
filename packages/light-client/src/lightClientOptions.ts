export type LightClientP2PConfig = {
  discv5: {enr: string; bindAddrs: {ip4?: string; ip6?: string}; bootEnrs: string[]; config?: {enrUpdate?: boolean}};
  localMultiaddrs: string[];
  version?: string;
};
