using KeyBox.Core.Auth;
using Xunit;

namespace KeyBox.Core.Tests;

public class SessionStoreTests : IDisposable
{
    private readonly string _dir;
    private readonly string _path;

    public SessionStoreTests()
    {
        _dir = Path.Combine(Path.GetTempPath(), "keybox-tests-" + Guid.NewGuid().ToString("N"));
        _path = Path.Combine(_dir, "session.json");
        Directory.CreateDirectory(_dir);
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); }
        catch (IOException) { }
    }

    [Fact]
    public void Save_Then_Load_RoundTrips_All_Fields()
    {
        var store = new SessionStore(_path);
        var session = new Session("acc", "ref", 7200, "uid-9");

        store.Save(session);
        Session? loaded = store.Load();

        Assert.NotNull(loaded);
        Assert.Equal("acc", loaded!.AccessToken);
        Assert.Equal("ref", loaded.RefreshToken);
        Assert.Equal(7200, loaded.ExpiresIn);
        Assert.Equal("uid-9", loaded.Uid);
    }

    [Fact]
    public void Save_Overwrites_Previous_Session()
    {
        var store = new SessionStore(_path);
        store.Save(new Session("acc-1", "ref-1", 7200, "u1"));
        store.Save(new Session("acc-2", "ref-2", 7200, "u2"));

        Session? loaded = store.Load();
        Assert.Equal("acc-2", loaded!.AccessToken);
    }

    [Fact]
    public void Load_Missing_File_Returns_Null()
    {
        var store = new SessionStore(_path);
        Assert.Null(store.Load());
    }

    [Fact]
    public void Load_Corrupt_File_Returns_Null()
    {
        File.WriteAllText(_path, "{ not valid json !!!");
        var store = new SessionStore(_path);
        Assert.Null(store.Load());
    }

    [Fact]
    public void Delete_Removes_File()
    {
        var store = new SessionStore(_path);
        store.Save(new Session("acc", "ref", 7200, "u1"));
        Assert.True(File.Exists(_path));

        store.Delete();
        Assert.False(File.Exists(_path));
        Assert.Null(store.Load());
    }
}
