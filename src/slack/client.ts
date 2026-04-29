import {
  type AuthTestArguments,
  type ChatPostMessageArguments,
  type ConversationsHistoryArguments,
  type ConversationsInfoArguments,
  type ConversationsListArguments,
  type ConversationsRepliesArguments,
  type FilesUploadV2Arguments,
  type SearchMessagesArguments,
  type UsersInfoArguments,
  type UsersListArguments,
  type UsersLookupByEmailArguments,
  type WebAPICallResult,
  WebClient,
  WebClientEvent,
} from "@slack/web-api";
import { type Logger, StderrLogger } from "./logger.ts";

export interface SlackClientOptions {
  maxRetries?: number;
  logger?: Logger;
}

export interface SlackClientConfig {
  team_id: string;
  token: string;
  options?: SlackClientOptions;
}

interface RateLimitedContext {
  url: string;
  body?: unknown;
}

const DEFAULT_MAX_RETRIES = 3;

export class SlackClient {
  private readonly client: WebClient;
  private readonly logger: Logger;
  private readonly team_id: string;

  constructor(config: SlackClientConfig) {
    this.team_id = config.team_id;
    this.logger = config.options?.logger ?? new StderrLogger();
    this.client = new WebClient(config.token, {
      teamId: config.team_id,
      retryConfig: {
        retries: config.options?.maxRetries ?? DEFAULT_MAX_RETRIES,
        factor: 2,
        randomize: true,
      },
    });
    this.client.on(WebClientEvent.RATE_LIMITED, this.onRateLimited);
  }

  private onRateLimited = (retrySec: number, ctx: RateLimitedContext): void => {
    this.logger.warn(`rate limited retry_after=${retrySec}s url=${ctx.url} team=${this.team_id}`);
  };

  apiCall = (method: string, params?: Record<string, unknown>): Promise<WebAPICallResult> =>
    this.client.apiCall(method, params);

  authTest = (args?: AuthTestArguments) => this.client.auth.test(args);

  conversationsHistory = (args: ConversationsHistoryArguments) =>
    this.client.conversations.history(args);

  conversationsReplies = (args: ConversationsRepliesArguments) =>
    this.client.conversations.replies(args);

  conversationsList = (args?: ConversationsListArguments) => this.client.conversations.list(args);

  conversationsInfo = (args: ConversationsInfoArguments) => this.client.conversations.info(args);

  chatPostMessage = (args: ChatPostMessageArguments) => this.client.chat.postMessage(args);

  filesUploadV2 = (args: FilesUploadV2Arguments) => this.client.filesUploadV2(args);

  usersInfo = (args: UsersInfoArguments) => this.client.users.info(args);

  usersList = (args?: UsersListArguments) => this.client.users.list(args ?? {});

  usersLookupByEmail = (args: UsersLookupByEmailArguments) => this.client.users.lookupByEmail(args);

  searchMessages = (args: SearchMessagesArguments) => this.client.search.messages(args);
}
