using System.Net;
using System.Net.Http.Headers;
using System.Text;

namespace KeyBox.Core.Tests;

/// <summary>
/// 请求快照：在生产代码把 HttpRequestMessage 释放（using）后仍可断言。
/// </summary>
internal sealed class RecordedRequest
{
    public required HttpMethod Method { get; init; }
    public required Uri? Uri { get; init; }
    public AuthenticationHeaderValue? Authorization { get; init; }
    public required IReadOnlyDictionary<string, string[]> Headers { get; init; }
    public required string Body { get; init; }

    public string? Header(string name)
        => Headers.TryGetValue(name, out string[]? v) ? string.Join(",", v) : null;
}

/// <summary>
/// 可编程 HttpMessageHandler：按请求返回预设响应，并在请求被释放前快照其
/// Method / Uri / 认证头 / 其它头 / Body，供测试断言 HTTP 契约。
/// 支持异步 responder（可 await 门闩/延迟），避免同步阻塞测试线程。
/// </summary>
internal sealed class StubHttpHandler : HttpMessageHandler
{
    private readonly Func<HttpRequestMessage, Task<HttpResponseMessage>> _responder;
    public List<RecordedRequest> Requests { get; } = new();

    public StubHttpHandler(Func<HttpRequestMessage, Task<HttpResponseMessage>> responder)
    {
        _responder = responder;
    }

    public static StubHttpHandler Json(Func<HttpRequestMessage, string> jsonResponder, HttpStatusCode status = HttpStatusCode.OK)
        => new(req => Task.FromResult(new HttpResponseMessage(status)
        {
            Content = new StringContent(jsonResponder(req), Encoding.UTF8, "application/json"),
        }));

    public static StubHttpHandler Async(Func<HttpRequestMessage, Task<HttpResponseMessage>> responder)
        => new(responder);

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var headers = request.Headers.ToDictionary(
            h => h.Key, h => h.Value.ToArray(), StringComparer.OrdinalIgnoreCase);
        string body = request.Content is null
            ? ""
            : request.Content.ReadAsStringAsync().GetAwaiter().GetResult();

        Requests.Add(new RecordedRequest
        {
            Method = request.Method,
            Uri = request.RequestUri,
            Authorization = request.Headers.Authorization,
            Headers = headers,
            Body = body,
        });

        return await _responder(request).ConfigureAwait(false);
    }
}

internal static class TestJson
{
    public static string Session(
        string accessToken = "access-token-1",
        string refreshToken = "refresh-token-1",
        long expiresIn = 7200,
        string uid = "uid-123") =>
        System.Text.Json.JsonSerializer.Serialize(new
        {
            access_token = accessToken,
            refresh_token = refreshToken,
            expires_in = expiresIn,
            sub = uid,
        });

    public static HttpResponseMessage Ok(string json) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(json, Encoding.UTF8, "application/json"),
    };
}
